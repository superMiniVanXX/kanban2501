from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.task import Task
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectStatusUpdate, ProjectResponse, ProjectTreeResponse
from app.services.project_service import build_project_tree, would_create_cycle
from app.services.activity_service import log_activity

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Project)
    if status:
        q = q.filter(Project.status == status)
    return q.order_by(Project.created_at.desc()).all()


@router.post("/projects", response_model=ProjectResponse, status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    if data.parent_id:
        parent = db.query(Project).filter(Project.id == data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent project not found")
    project = Project(**data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/tree", response_model=list[ProjectTreeResponse])
def list_project_tree(db: Session = Depends(get_db)):
    all_projects = db.query(Project).order_by(Project.created_at.asc()).all()
    all_tasks = db.query(Task).all()
    tasks_by_project: dict[str, list] = {}
    for t in all_tasks:
        tasks_by_project.setdefault(t.project_id, []).append(t)
    completion_map: dict[str, bool] = {}
    task_stats: dict[str, dict] = {}
    for pid, tasks in tasks_by_project.items():
        active = [t for t in tasks if t.status != "cancelled"]
        completion_map[pid] = len(active) > 0 and all(t.status == "done" for t in active)
        task_stats[pid] = {"active": len(active), "done": sum(1 for t in active if t.status == "done")}
    return build_project_tree(all_projects, completion_map, task_stats)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, data: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    update_data = data.model_dump(exclude_unset=True)
    if "parent_id" in update_data and update_data["parent_id"] is not None:
        new_parent = update_data["parent_id"]
        parent = db.query(Project).filter(Project.id == new_parent).first()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent project not found")
        if would_create_cycle(db, project_id, new_parent):
            raise HTTPException(status_code=400, detail="Cannot set a descendant as parent")
    for k, v in update_data.items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()


@router.put("/projects/{project_id}/status", response_model=ProjectResponse)
def update_project_status(project_id: str, data: ProjectStatusUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    valid = {"planning", "active", "on_hold", "completed", "archived"}
    if data.status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid}")
    old_status = project.status
    project.status = data.status
    db.commit()
    db.refresh(project)
    log_activity(db, project.id, "project_status_changed", "project", project.id, project.name,
                 f"'{project.name}': {old_status} → {project.status}",
                 {"old_status": old_status, "new_status": project.status})
    return project
