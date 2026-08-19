from datetime import datetime, timedelta
import pytest

from app.models.project import Project
from app.models.task import Task
from app.models.task_status_history import TaskStatusHistory
from app.services.activity_service import get_recent_activity


def _project(db, name="P", exclude=False):
    p = Project(id=f"proj-{name}", name=name, exclude_from_stats=exclude)
    db.add(p)
    db.flush()
    return p


def _task(db, project, title="T", status="todo", exclude=False):
    t = Task(
        id=f"task-{title}",
        project_id=project.id,
        title=title,
        status=status,
        priority="medium",
        task_type="task",
        progress=0,
        exclude_from_stats=exclude,
    )
    db.add(t)
    db.flush()
    return t


def _history(db, task, new_status, changed_at, old_status="backlog"):
    db.add(TaskStatusHistory(
        task_id=task.id,
        project_id=task.project_id,
        old_status=old_status,
        new_status=new_status,
        old_progress=0,
        new_progress=0,
        changed_at=changed_at,
    ))
    db.flush()


def test_window_membership(db_session):
    db = db_session
    proj = _project(db, "W")
    recent = _task(db, proj, "recent", status="in_progress")
    _history(db, recent, "in_progress", datetime.utcnow() - timedelta(hours=2))
    old = _task(db, proj, "old", status="todo")
    _history(db, old, "todo", datetime.utcnow() - timedelta(days=10))
    db.commit()

    ids = [r.id for r in get_recent_activity(db, days=7)]
    assert recent.id in ids
    assert old.id not in ids


def test_sorted_by_last_changed_desc(db_session):
    db = db_session
    proj = _project(db, "S")
    earlier = _task(db, proj, "earlier", status="review")
    _history(db, earlier, "review", datetime.utcnow() - timedelta(days=2))
    later = _task(db, proj, "later", status="review")
    _history(db, later, "review", datetime.utcnow() - timedelta(hours=3))
    db.commit()

    titles = [r.title for r in get_recent_activity(db, days=7)]
    assert titles.index("later") < titles.index("earlier")


def test_backlog_excluded(db_session):
    db = db_session
    proj = _project(db, "B")
    t = _task(db, proj, "bl", status="backlog")
    _history(db, t, "backlog", datetime.utcnow())
    db.commit()
    assert get_recent_activity(db, days=1) == []


def test_multiple_transitions_single_row_in_current_status(db_session):
    db = db_session
    proj = _project(db, "M")
    t = _task(db, proj, "multi", status="done")
    base = datetime.utcnow() - timedelta(days=3)
    _history(db, t, "todo", base, old_status="backlog")
    _history(db, t, "in_progress", base + timedelta(hours=1), old_status="todo")
    _history(db, t, "done", base + timedelta(hours=2), old_status="in_progress")
    db.commit()

    matches = [r for r in get_recent_activity(db, days=7) if r.id == t.id]
    assert len(matches) == 1
    assert matches[0].status == "done"


def test_excluded_from_stats_filtered(db_session):
    db = db_session
    ok_proj = _project(db, "ok")
    ok_task = _task(db, ok_proj, "ok", status="todo")
    _history(db, ok_task, "todo", datetime.utcnow())
    excl_proj = _project(db, "excl-proj", exclude=True)
    excl_task_p = _task(db, excl_proj, "excl-proj-task", status="todo")
    _history(db, excl_task_p, "todo", datetime.utcnow())
    excl_task = _task(db, ok_proj, "excl-task", status="todo", exclude=True)
    _history(db, excl_task, "todo", datetime.utcnow())
    db.commit()

    ids = {r.id for r in get_recent_activity(db, days=1)}
    assert ok_task.id in ids
    assert excl_task_p.id not in ids
    assert excl_task.id not in ids


def test_soft_deleted_excluded(db_session):
    db = db_session
    proj = _project(db, "D")
    alive = _task(db, proj, "alive", status="todo")
    _history(db, alive, "todo", datetime.utcnow())
    dead = _task(db, proj, "dead", status="todo")
    dead.deleted_at = datetime.utcnow()
    _history(db, dead, "todo", datetime.utcnow())
    db.commit()

    ids = {r.id for r in get_recent_activity(db, days=1)}
    assert alive.id in ids
    assert dead.id not in ids


def test_invalid_days_raises(db_session):
    with pytest.raises(ValueError):
        get_recent_activity(db_session, days=5)


def test_endpoint_param_validation(client):
    assert client.get("/api/v1/tasks/activity?days=5").status_code == 422


def test_endpoint_happy_path(client, db_session):
    proj = Project(id="proj-ep", name="EP")
    db_session.add(proj)
    db_session.flush()
    t = Task(id="task-ep", project_id=proj.id, title="EP", status="done",
             priority="high", task_type="task", progress=100)
    db_session.add(t)
    db_session.flush()
    db_session.add(TaskStatusHistory(
        task_id=t.id, project_id=proj.id, old_status="review", new_status="done",
        old_progress=0, new_progress=100, changed_at=datetime.utcnow(),
    ))
    db_session.commit()

    resp = client.get("/api/v1/tasks/activity?days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "task-ep"
    assert data[0]["status"] == "done"
    assert data[0]["project_name"] == "EP"
    assert "last_changed_at" in data[0]
