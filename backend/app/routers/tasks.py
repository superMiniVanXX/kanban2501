import logging
import subprocess
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_

logger = logging.getLogger("kanban.tasks")

from app.database import get_db
from app.models.task import Task, TaskCodeProject
from app.models.project import Project
from app.models.execution_config import ExecutionConfig
from app.models.task_status_history import TaskStatusHistory
from app.models.worktree import Worktree
from app.models.worktree_config import WorktreeConfig
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskMove, TaskResponse, TaskSearchResponse
from app.schemas.execution_config import ExecuteRequest, ExecuteResponse
from app.services.activity_service import log_activity
from app.services.workflow_service import validate_transition
from app.services.worktree_service import expand_template, validate_repo, create_worktree, remove_worktree

router = APIRouter(tags=["tasks"])


class CreateSubProjectRequest(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None

VALID_STATUSES = {"backlog", "todo", "in_progress", "review", "done", "verify", "complete", "cancelled"}


def _activate_pending_worktree(task: Task, db: Session) -> dict:
    """Run `git worktree add` for a pending worktree and update its status.

    Called from two sites:
      - change_task_status (status → in_progress): silent on failure, just marks error
      - execute_task (lazy activation): caller raises HTTPException on failure

    Contract:
      - If task has no worktree, or worktree.status != "pending": no-op, return success.
      - On success: worktree.status set to "active", committed, return {"success": True, "error": None}.
      - On failure: worktree.status set to "error" with error_message, committed,
        return {"success": False, "error": "<human-readable reason>"}.

    """
    if not task.worktree or task.worktree.status != "pending":
        return {"success": True, "error": None}

    wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == task.worktree.config_id).first()
    if not wt_config:
        task.worktree.status = "error"
        task.worktree.error_message = "Worktree config not found"
        db.commit()
        return {"success": False, "error": "Worktree config not found"}

    repo_check = validate_repo(wt_config.base_repo_path)
    if not repo_check["valid"]:
        task.worktree.status = "error"
        task.worktree.error_message = repo_check["error"]
        db.commit()
        return {"success": False, "error": repo_check["error"]}

    result = create_worktree(wt_config.base_repo_path, task.worktree.branch, task.worktree.path)
    if result["success"]:
        task.worktree.status = "active"
    else:
        task.worktree.status = "error"
        task.worktree.error_message = result["error"]

    db.commit()
    return result


@router.get("/tasks/recent", response_model=list[TaskSearchResponse])
def recent_tasks(limit: int = 15, db: Session = Depends(get_db)):
    rows = (
        db.query(Task, Project.name.label("project_name"))
        .join(Project, Task.project_id == Project.id)
        .filter(Task.deleted_at.is_(None))
        .order_by(Task.updated_at.desc())
        .limit(min(limit, 50))
        .all()
    )
    return [
        TaskSearchResponse(
            id=t.id,
            project_id=t.project_id,
            title=t.title,
            status=t.status,
            priority=t.priority,
            task_type=t.task_type,
            assignee=t.assignee,
            due_date=t.due_date,
            sub_project_id=t.sub_project_id,
            project_name=pn,
        )
        for t, pn in rows
    ]


@router.get("/tasks/search", response_model=list[TaskSearchResponse])
def search_tasks(q: str, db: Session = Depends(get_db)):
    keyword = f"%{q}%"
    rows = (
        db.query(Task, Project.name.label("project_name"))
        .join(Project, Task.project_id == Project.id)
        .filter(
            Task.deleted_at.is_(None),
            or_(
                Task.title.ilike(keyword),
                Task.description.ilike(keyword),
                Task.assignee.ilike(keyword),
            )
        )
        .order_by(Task.updated_at.desc())
        .limit(20)
        .all()
    )
    return [
        TaskSearchResponse(
            id=t.id,
            project_id=t.project_id,
            title=t.title,
            status=t.status,
            priority=t.priority,
            task_type=t.task_type,
            assignee=t.assignee,
            due_date=t.due_date,
            sub_project_id=t.sub_project_id,
            project_name=pn,
        )
        for t, pn in rows
    ]


@router.get("/projects/{project_id}/tasks", response_model=list[TaskResponse])
def list_tasks(project_id: str, status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Task).options(selectinload(Task.code_projects), selectinload(Task.worktree)).filter(Task.project_id == project_id, Task.deleted_at.is_(None))
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.sort_order, Task.created_at).all()


@router.post("/projects/{project_id}/tasks", response_model=TaskResponse, status_code=201)
def create_task(project_id: str, data: TaskCreate, db: Session = Depends(get_db)):
    task_data = data.model_dump()
    cp_ids = task_data.pop("code_project_ids", None)
    wt_config_id = task_data.pop("worktree_config_id", None)
    task = Task(project_id=project_id, **task_data)
    db.add(task)
    db.flush()
    if cp_ids:
        for cp_id in cp_ids:
            db.add(TaskCodeProject(task_id=task.id, code_project_id=cp_id))
    if wt_config_id:
        wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == wt_config_id).first()
        if wt_config:
            project = db.query(Project).filter(Project.id == project_id).first()
            branch = expand_template(wt_config.branch_template, task, project)
            path = expand_template(wt_config.dir_template, task, project, branch=branch)
            wt = Worktree(
                task_id=task.id,
                config_id=wt_config.id,
                branch=branch,
                path=path,
                status="pending",
            )
            db.add(wt)
            db.flush()
            task.worktree_id = wt.id
    db.commit()
    db.refresh(task)
    log_activity(db, project_id, "task_created", "task", task.id, task.title,
                 f"Task '{task.title}' created")
    return task


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).options(selectinload(Task.code_projects), selectinload(Task.worktree)).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, data: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    update_data = data.model_dump(exclude_unset=True)
    code_project_ids = update_data.pop("code_project_ids", None)
    worktree_config_id = update_data.pop("worktree_config_id", None)
    for k, v in update_data.items():
        setattr(task, k, v)
    if code_project_ids is not None:
        db.query(TaskCodeProject).filter(TaskCodeProject.task_id == task_id).delete()
        for cp_id in code_project_ids:
            db.add(TaskCodeProject(task_id=task_id, code_project_id=cp_id))
    if worktree_config_id is not None and not task.worktree:
        if worktree_config_id:
            wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == worktree_config_id).first()
            if wt_config:
                project = db.query(Project).filter(Project.id == task.project_id).first()
                branch = expand_template(wt_config.branch_template, task, project)
                path = expand_template(wt_config.dir_template, task, project, branch=branch)
                wt = Worktree(
                    task_id=task.id,
                    config_id=wt_config.id,
                    branch=branch,
                    path=path,
                    status="pending",
                )
                db.add(wt)
                db.flush()
                task.worktree_id = wt.id
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.deleted_at = datetime.utcnow()
    db.commit()
    log_activity(db, task.project_id, "task_deleted", "task", task_id, task.title,
                 f"Task '{task.title}' deleted (was {task.status})")


@router.put("/tasks/{task_id}/status", response_model=TaskResponse)
def change_task_status(task_id: str, data: TaskStatusUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {VALID_STATUSES}")
    error = validate_transition(task, data.status)
    if error:
        raise HTTPException(status_code=422, detail=error)
    old_status = task.status
    old_progress = task.progress
    task.status = data.status
    if data.status == "in_progress" and task.start_date is None:
        task.start_date = date.today()
    if data.status == "done":
        task.completed_at = datetime.utcnow()
        task.progress = 100
    elif data.status in ("verify", "complete"):
        pass  # keep completed_at and progress from done
    else:
        task.completed_at = None
    db.commit()
    db.refresh(task)
    # Worktree hooks
    if data.status == "in_progress":
        _activate_pending_worktree(task, db)
    if data.status in ("verify", "cancelled") and task.worktree and task.worktree.status == "active":
        wt_config = db.query(WorktreeConfig).filter(WorktreeConfig.id == task.worktree.config_id).first()
        if wt_config and wt_config.auto_cleanup:
            result = remove_worktree(task.worktree.path)
            if result["success"]:
                task.worktree.status = "removed"
                task.worktree_id = None
            else:
                task.worktree.status = "error"
                task.worktree.error_message = result["error"]
            db.commit()
    db.refresh(task)
    db.add(TaskStatusHistory(
        task_id=task.id,
        project_id=task.project_id,
        old_status=old_status,
        new_status=task.status,
        old_progress=old_progress,
        new_progress=task.progress,
        changed_at=datetime.utcnow(),
    ))
    db.commit()
    log_activity(db, task.project_id, "task_status_changed", "task", task.id, task.title,
                 f"'{task.title}': {old_status} → {task.status}",
                 {"old_status": old_status, "new_status": task.status})
    return task


@router.put("/tasks/{task_id}/move", response_model=TaskResponse)
def move_task(task_id: str, data: TaskMove, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.sort_order = data.sort_order
    db.commit()
    db.refresh(task)
    return task


@router.post("/tasks/{task_id}/create-sub-project", response_model=TaskResponse, status_code=201)
def create_sub_project(task_id: str, data: CreateSubProjectRequest, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.sub_project_id:
        raise HTTPException(status_code=400, detail="Task already has a sub-project")
    sub = Project(name=data.name, description=data.description, parent_id=task.project_id)
    db.add(sub)
    db.flush()
    task.sub_project_id = sub.id
    db.commit()
    db.refresh(task)
    return task


PLACEHOLDER_VARS = [
    "{task_id}", "{task_title}", "{task_status}", "{task_priority}", "{task_type}",
    "{task_assignee}", "{task_description}", "{task_acceptance_criteria}",
    "{task_implementation_plan}",
    "{task_due_date}", "{task_start_date}", "{task_estimated_hours}",
    "{task_actual_hours}", "{task_progress}", "{task_tags}", "{project_id}",
]


@router.post("/tasks/{task_id}/execute", response_model=ExecuteResponse)
def execute_task(task_id: str, data: ExecuteRequest, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    config = db.query(ExecutionConfig).filter(ExecutionConfig.id == data.config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Execution config not found")

    logger.info("Execute task '%s' (id=%s) with config '%s' (id=%s)",
                task.title, task.id, config.name, config.id)
    logger.debug("Raw command template: %s", config.command_template)

    replacements = {
        "{task_id}": task.id,
        "{task_title}": task.title,
        "{task_status}": task.status or "",
        "{task_priority}": task.priority or "",
        "{task_type}": task.task_type or "",
        "{task_assignee}": task.assignee or "",
        "{task_description}": task.description or "",
        "{task_acceptance_criteria}": task.acceptance_criteria or "",
        "{task_implementation_plan}": task.implementation_plan or "",
        "{task_due_date}": str(task.due_date) if task.due_date else "",
        "{task_start_date}": str(task.start_date) if task.start_date else "",
        "{task_estimated_hours}": str(task.estimated_hours) if task.estimated_hours else "",
        "{task_actual_hours}": str(task.actual_hours) if task.actual_hours else "",
        "{task_progress}": str(task.progress),
        "{task_tags}": ", ".join(task.tags) if task.tags else "",
        "{project_id}": task.project_id,
    }

    cmd = config.command_template
    for token, value in replacements.items():
        cmd = cmd.replace(token, value)

    # Lazy worktree activation: if the task has a pending worktree, create it now
    # so execution runs inside the worktree directory.
    if task.worktree and task.worktree.status == "pending":
        activation = _activate_pending_worktree(task, db)
        if not activation["success"]:
            logger.warning("Lazy worktree activation failed for task '%s': %s",
                           task.title, activation["error"])
            raise HTTPException(
                status_code=422,
                detail=f"Worktree activation failed: {activation['error']}",
            )

    # Resolve working directory — prefer worktree path over code project path.
    # This is independent of ##workdir## replacement: cwd must be set regardless
    # of whether the command template contains the placeholder.
    workdir = None
    workdir_source = ""
    if task.worktree and task.worktree.status == "active":
        workdir = task.worktree.path
        workdir_source = f"worktree '{task.worktree.branch}'"
    elif task.code_projects:
        workdir = task.code_projects[0].path
        workdir_source = f"code project '{task.code_projects[0].name}'"

    if workdir:
        logger.info("Working directory resolved to: %s (from %s)", workdir, workdir_source)

    # Replace ##workdir## placeholder with the resolved path, or fail if the
    # template requires it but no directory is available.
    if "##workdir##" in cmd:
        if not workdir:
            if task.code_projects and not task.code_projects[0].path:
                cp_name = task.code_projects[0].name
                logger.error("##workdir## in command but code project '%s' has no path configured", cp_name)
                raise HTTPException(
                    status_code=422,
                    detail=f"Command uses ##workdir## but linked code project '{cp_name}' has no path configured. "
                           f"Please set a path for code project '{cp_name}'.",
                )
            logger.error("##workdir## in command but task '%s' has no worktree or code projects", task.title)
            raise HTTPException(
                status_code=422,
                detail="Command uses ##workdir## but task has no worktree or linked code projects.",
            )
        cmd = cmd.replace("##workdir##", workdir)

    logger.info("Final command: %s", cmd)

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30, cwd=workdir)
        success = result.returncode == 0
        logger.info("Command finished: exit_code=%d, success=%s", result.returncode, success)
        if result.stdout:
            logger.debug("stdout: %s", result.stdout[:500])
        if result.stderr:
            logger.warning("stderr: %s", result.stderr[:500])
        log_activity(db, task.project_id, "task_executed", "task", task.id, task.title,
                     f"Executed '{config.name}': {'success' if success else 'failed'}",
                     {"config_name": config.name, "success": success, "exit_code": result.returncode})
        return ExecuteResponse(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.returncode,
            success=success,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Command timed out after 30s: %s", cmd[:200])
        log_activity(db, task.project_id, "task_executed", "task", task.id, task.title,
                     f"Executed '{config.name}': timed out",
                     {"config_name": config.name, "success": False, "error": "timeout"})
        return ExecuteResponse(
            stdout="",
            stderr="Command timed out after 30 seconds",
            exit_code=-1,
            success=False,
        )
    except Exception as e:
        logger.exception("Command execution failed: %s", e)
        log_activity(db, task.project_id, "task_executed", "task", task.id, task.title,
                     f"Executed '{config.name}': error - {e}",
                     {"config_name": config.name, "success": False, "error": str(e)})
        return ExecuteResponse(
            stdout="",
            stderr=str(e),
            exit_code=-1,
            success=False,
        )
