import subprocess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app.models.task import Task, TaskCodeProject
from app.models.project import Project
from app.models.execution_config import ExecutionConfig
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskMove, TaskResponse, TaskSearchResponse
from app.schemas.execution_config import ExecuteRequest, ExecuteResponse
from app.services.activity_service import log_activity
from app.services.workflow_service import validate_transition

router = APIRouter(tags=["tasks"])


class CreateSubProjectRequest(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None

VALID_STATUSES = {"backlog", "todo", "in_progress", "review", "done", "cancelled"}


@router.get("/tasks/search", response_model=list[TaskSearchResponse])
def search_tasks(q: str, db: Session = Depends(get_db)):
    keyword = f"%{q}%"
    rows = (
        db.query(Task, Project.name.label("project_name"))
        .join(Project, Task.project_id == Project.id)
        .filter(
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
    q = db.query(Task).filter(Task.project_id == project_id)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.sort_order, Task.created_at).all()


@router.post("/projects/{project_id}/tasks", response_model=TaskResponse, status_code=201)
def create_task(project_id: str, data: TaskCreate, db: Session = Depends(get_db)):
    task_data = data.model_dump()
    cp_ids = task_data.pop("code_project_ids", None)
    task = Task(project_id=project_id, **task_data)
    db.add(task)
    db.flush()
    if cp_ids:
        for cp_id in cp_ids:
            db.add(TaskCodeProject(task_id=task.id, code_project_id=cp_id))
    db.commit()
    db.refresh(task)
    log_activity(db, project_id, "task_created", "task", task.id, task.title,
                 f"Task '{task.title}' created")
    return task


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
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
    for k, v in update_data.items():
        setattr(task, k, v)
    if code_project_ids is not None:
        db.query(TaskCodeProject).filter(TaskCodeProject.task_id == task_id).delete()
        for cp_id in code_project_ids:
            db.add(TaskCodeProject(task_id=task_id, code_project_id=cp_id))
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    project_id = task.project_id
    title = task.title
    old_status = task.status
    db.delete(task)
    db.commit()
    log_activity(db, project_id, "task_deleted", "task", task_id, title,
                 f"Task '{title}' deleted (was {old_status})")


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
    task.status = data.status
    if data.status == "done":
        task.completed_at = datetime.utcnow()
        task.progress = 100
    else:
        task.completed_at = None
    db.commit()
    db.refresh(task)
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

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        success = result.returncode == 0
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
        log_activity(db, task.project_id, "task_executed", "task", task.id, task.title,
                     f"Executed '{config.name}': error - {e}",
                     {"config_name": config.name, "success": False, "error": str(e)})
        return ExecuteResponse(
            stdout="",
            stderr=str(e),
            exit_code=-1,
            success=False,
        )
