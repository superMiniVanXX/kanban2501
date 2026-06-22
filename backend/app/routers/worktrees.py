import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.worktree import Worktree
from app.models.worktree_config import WorktreeConfig
from app.schemas.worktree import WorktreeResponse, WorktreeCreateRequest
from app.services.worktree_service import expand_template, validate_repo, create_worktree, remove_worktree, open_worktree

logger = logging.getLogger(__name__)

router = APIRouter(tags=["worktrees"])


def _get_task_or_404(task_id: str, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _do_create_worktree(task: Task, config: WorktreeConfig, db: Session) -> Worktree:
    project = task.project

    branch = expand_template(config.branch_template, task, project)
    path = expand_template(config.dir_template, task, project, branch=branch)

    repo_check = validate_repo(config.base_repo_path)
    if not repo_check["valid"]:
        raise HTTPException(status_code=422, detail=f"Invalid base repository: {repo_check['error']}")

    result = create_worktree(config.base_repo_path, branch, path)

    if result["success"]:
        wt = Worktree(
            task_id=task.id,
            config_id=config.id,
            branch=branch,
            path=path,
            status="active",
        )
    else:
        wt = Worktree(
            task_id=task.id,
            config_id=config.id,
            branch=branch,
            path=path,
            status="error",
            error_message=result["error"],
        )

    db.add(wt)
    db.flush()
    task.worktree_id = wt.id
    db.commit()
    db.refresh(wt)
    return wt


@router.post("/tasks/{task_id}/worktree", response_model=WorktreeResponse, status_code=201)
def create_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    if task.worktree and task.worktree.status == "active":
        raise HTTPException(status_code=409, detail="Task already has an active worktree. Use PUT to rebuild.")

    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")

    wt = _do_create_worktree(task, config, db)
    if wt.status == "error":
        raise HTTPException(status_code=500, detail=f"Worktree creation failed: {wt.error_message}")
    return wt


@router.get("/tasks/{task_id}/worktree", response_model=WorktreeResponse)
def get_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree:
        raise HTTPException(status_code=404, detail="Task has no worktree")
    return task.worktree


@router.put("/tasks/{task_id}/worktree", response_model=WorktreeResponse)
def rebuild_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Worktree config not found")

    if task.worktree and task.worktree.status == "active":
        result = remove_worktree(task.worktree.path)
        if result["success"]:
            task.worktree.status = "removed"
            db.commit()
        else:
            task.worktree.status = "error"
            task.worktree.error_message = f"Failed to remove old worktree: {result['error']}"
            db.commit()

    wt = _do_create_worktree(task, config, db)
    if wt.status == "error":
        raise HTTPException(status_code=500, detail=f"Worktree creation failed: {wt.error_message}")
    return wt


@router.post("/tasks/{task_id}/worktree/open")
def open_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree or task.worktree.status != "active":
        raise HTTPException(status_code=404, detail="Task has no active worktree")
    result = open_worktree(task.worktree.path)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return {"ok": True}


@router.delete("/tasks/{task_id}/worktree", status_code=204)
def delete_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree or task.worktree.status == "removed":
        raise HTTPException(status_code=404, detail="Task has no worktree to remove")

    if task.worktree.status == "active":
        result = remove_worktree(task.worktree.path)
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"Failed to remove worktree: {result['error']}")
    task.worktree.status = "removed"
    task.worktree_id = None
    db.commit()
