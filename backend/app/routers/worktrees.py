import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.worktree import Worktree
from app.models.worktree_config import WorktreeConfig
from app.schemas.worktree import WorktreeResponse, WorktreeCreateRequest, WorktreeImportRequest
from app.services.worktree_service import expand_template, validate_repo, create_worktree, remove_worktree, open_worktree, import_worktree

logger = logging.getLogger(__name__)

router = APIRouter(tags=["worktrees"])


def _get_task_or_404(task_id: str, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _do_create_worktree(
    task: Task,
    db: Session,
    config: WorktreeConfig | None = None,
    *,
    branch: str | None = None,
    path: str | None = None,
    base_repo_path: str | None = None,
) -> Worktree:
    """Create a worktree for the task.

    Config mode: pass ``config``; branch/path are expanded from templates.
    Manual mode: pass ``config=None`` with explicit ``branch``, ``path``,
    and ``base_repo_path`` — no template expansion, fully user-specified.
    """
    project = task.project

    if config:
        config_id = config.id
        branch_val = expand_template(config.branch_template, task, project)
        path_val = expand_template(config.dir_template, task, project, branch=branch_val)
        repo_path = config.base_repo_path
    else:
        config_id = None
        branch_val = branch or ""
        path_val = path or ""
        repo_path = base_repo_path or ""

    if not branch_val or not path_val or not repo_path:
        raise HTTPException(
            status_code=422,
            detail="Manual worktree requires branch, path, and base_repo_path",
        )

    repo_check = validate_repo(repo_path)
    if not repo_check["valid"]:
        raise HTTPException(status_code=422, detail=f"Invalid base repository: {repo_check['error']}")

    result = create_worktree(repo_path, branch_val, path_val)

    if result["success"]:
        wt = Worktree(
            task_id=task.id,
            config_id=config_id,
            base_repo_path=repo_path if not config_id else None,
            branch=branch_val,
            path=path_val,
            status="active",
        )
    else:
        wt = Worktree(
            task_id=task.id,
            config_id=config_id,
            base_repo_path=repo_path if not config_id else None,
            branch=branch_val,
            path=path_val,
            status="error",
            error_message=result["error"],
        )

    db.add(wt)
    db.flush()
    task.worktree_id = wt.id
    task.worktree_config_id = config_id
    db.commit()
    db.refresh(wt)

    # Auto-install agent hooks into the worktree directory. Two parallel
    # mechanisms so the same notification channels cover whichever tool the
    # user runs from the worktree:
    #   - Claude Code: global forwarder script + .claude/settings.json entry
    #   - opencode:    self-contained plugin in .opencode/plugins/
    try:
        from app.services.worktree_hooks import ensure_forwarder_script, write_hooks_to_worktree
        ensure_forwarder_script()
        write_hooks_to_worktree(wt.path)
    except Exception as e:
        logger.warning("Failed to install Claude Code hooks: %s", e)

    try:
        from app.services.opencode_hooks import write_plugin_to_worktree
        write_plugin_to_worktree(wt.path)
    except Exception as e:
        logger.warning("Failed to install opencode plugin: %s", e)

    return wt


@router.post("/tasks/{task_id}/worktree", response_model=WorktreeResponse, status_code=201)
def create_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    if task.worktree and task.worktree.status == "active":
        raise HTTPException(status_code=409, detail="Task already has an active worktree. Use PUT to rebuild.")

    config: WorktreeConfig | None = None
    if data.config_id:
        config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
        if not config:
            raise HTTPException(status_code=404, detail="Worktree config not found")
    else:
        if not (data.branch and data.path and data.base_repo_path):
            raise HTTPException(
                status_code=422,
                detail="Manual worktree requires branch, path, and base_repo_path",
            )

    wt = _do_create_worktree(
        task, db, config,
        branch=data.branch, path=data.path, base_repo_path=data.base_repo_path,
    )
    if wt.status == "error":
        raise HTTPException(status_code=500, detail=f"Worktree creation failed: {wt.error_message}")
    return wt


@router.post("/tasks/{task_id}/worktree/import", response_model=WorktreeResponse, status_code=201)
def import_task_worktree(task_id: str, data: WorktreeImportRequest, db: Session = Depends(get_db)):
    """Associate an existing directory with the task as its worktree.

    Does NOT run `git worktree add` — the directory already exists on disk.
    If it is a git repo, the current branch is read automatically. Plain
    folders are allowed (branch stays empty).
    """
    task = _get_task_or_404(task_id, db)

    if task.worktree and task.worktree.status == "active":
        raise HTTPException(status_code=409, detail="Task already has an active worktree. Use PUT to rebuild.")

    result = import_worktree(data.path)
    if not result["success"]:
        raise HTTPException(status_code=422, detail=result["error"])

    wt = Worktree(
        task_id=task.id,
        config_id=None,
        base_repo_path=None,
        branch=result["branch"] or "",
        path=str(Path(data.path).resolve()),
        status="active",
    )
    db.add(wt)
    db.flush()
    task.worktree_id = wt.id
    task.worktree_config_id = "manual"
    db.commit()
    db.refresh(wt)

    # Same agent-hook installation as created worktrees so imported dirs
    # get the same notification wiring.
    try:
        from app.services.worktree_hooks import ensure_forwarder_script, write_hooks_to_worktree
        ensure_forwarder_script()
        write_hooks_to_worktree(wt.path)
    except Exception as e:
        logger.warning("Failed to install Claude Code hooks: %s", e)

    try:
        from app.services.opencode_hooks import write_plugin_to_worktree
        write_plugin_to_worktree(wt.path)
    except Exception as e:
        logger.warning("Failed to install opencode plugin: %s", e)

    return wt
def get_task_worktree(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)
    if not task.worktree:
        raise HTTPException(status_code=404, detail="Task has no worktree")
    return task.worktree


@router.put("/tasks/{task_id}/worktree", response_model=WorktreeResponse)
def rebuild_task_worktree(task_id: str, data: WorktreeCreateRequest, db: Session = Depends(get_db)):
    task = _get_task_or_404(task_id, db)

    config: WorktreeConfig | None = None
    if data.config_id:
        config = db.query(WorktreeConfig).filter(WorktreeConfig.id == data.config_id).first()
        if not config:
            raise HTTPException(status_code=404, detail="Worktree config not found")
    else:
        if not (data.branch and data.path and data.base_repo_path):
            raise HTTPException(
                status_code=422,
                detail="Manual worktree requires branch, path, and base_repo_path",
            )

    if task.worktree and task.worktree.status == "active":
        result = remove_worktree(task.worktree.path)
        if result["success"]:
            task.worktree.status = "removed"
            db.commit()
        else:
            task.worktree.status = "error"
            task.worktree.error_message = f"Failed to remove old worktree: {result['error']}"
            db.commit()

    wt = _do_create_worktree(
        task, db, config,
        branch=data.branch, path=data.path, base_repo_path=data.base_repo_path,
    )
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

    # Remove kanban-managed hooks from the worktree BEFORE the git call.
    # Hook cleanup is filesystem-only (touches settings.json / plugin files,
    # not git state), so doing it first means that if `git worktree remove`
    # fails the kanban hooks are still cleaned up and the user can retry
    # safely without leaking entries that point at our forwarder.
    try:
        from app.services.worktree_hooks import remove_hooks_from_worktree
        remove_hooks_from_worktree(task.worktree.path)
    except Exception as e:
        logger.warning("Failed to remove Claude Code hooks: %s", e)

    try:
        from app.services.opencode_hooks import remove_plugin_from_worktree
        remove_plugin_from_worktree(task.worktree.path)
    except Exception as e:
        logger.warning("Failed to remove opencode plugin: %s", e)

    if task.worktree.status == "active":
        result = remove_worktree(task.worktree.path)
        if not result["success"]:
            # Don't block DB cleanup if the git worktree is already gone
            # (path deleted manually, disk corrupted, etc). Log a warning
            # and proceed to mark the record as removed so the user isn't
            # stuck with an undeletable worktree record.
            logger.warning(
                "git worktree remove failed for %s, cleaning DB record anyway: %s",
                task.worktree.path, result["error"],
            )

    task.worktree.status = "removed"
    task.worktree_id = None
    task.worktree_config_id = "none"
    db.commit()
