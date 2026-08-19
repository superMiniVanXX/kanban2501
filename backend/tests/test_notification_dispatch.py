from unittest.mock import patch

import pytest

from app.models.notification_channel import NotificationChannel
from app.models.notification_log import NotificationLog
from app.models.project import Project
from app.models.task import Task
from app.models.worktree import Worktree
from app.services.notification_service import ingest_event


def _make_channel(db, name="ch", channel_type="desktop", config=None,
                  event_filters=None, project_filters=None, enabled=True):
    ch = NotificationChannel(
        name=name, channel_type=channel_type,
        config=config or {"command": "notify-send"},
        event_filters=event_filters or [],
        project_filters=project_filters or [],
        enabled=enabled,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


def _make_project_task(db):
    proj = Project(name="P1")
    db.add(proj)
    db.commit()
    db.refresh(proj)
    task = Task(project_id=proj.id, title="T1")
    db.add(task)
    db.commit()
    db.refresh(task)
    return proj, task


def test_ingest_no_channels_returns_zero(db_session):
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_ingest_dispatches_to_matching_channel(db_session):
    _make_channel(db_session)
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock_subprocess_ok()
        result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 1, "succeeded": 1, "failed": 0}
    logs = db_session.query(NotificationLog).all()
    assert len(logs) == 1
    assert logs[0].status == "success"
    assert logs[0].event_type == "Stop"


def test_ingest_continues_after_channel_failure(db_session):
    _make_channel(db_session, name="ok")
    _make_channel(db_session, name="bad", channel_type="webhook",
                  config={"url": "http://localhost:1/nope", "body_template": "{}"})
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run, \
         patch("app.services.notification_senders.webhook.requests.post") as mock_post:
        mock_run.return_value = MagicMock_subprocess_ok()
        mock_post.side_effect = Exception("conn refused")
        result = ingest_event(db_session, event_type="Stop")
    assert result["matched"] == 2
    assert result["succeeded"] == 1
    assert result["failed"] == 1
    logs = db_session.query(NotificationLog).order_by(NotificationLog.created_at).all()
    statuses = sorted(log.status for log in logs)
    assert statuses == ["failure", "success"]


def test_event_filter_excludes_non_matching_channel(db_session):
    _make_channel(db_session, event_filters=["task.done"])
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_project_filter_excludes_non_matching_channel(db_session):
    proj, task = _make_project_task(db_session)
    _make_channel(db_session, project_filters=["other-project-id"])
    result = ingest_event(db_session, event_type="Stop", project_id=proj.id)
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


def test_ingest_resolves_task_id_from_worktree_cwd(db_session):
    proj, task = _make_project_task(db_session)
    wt = Worktree(task_id=task.id, config_id=None, branch="b", path="/tmp/wt-xyz", status="active")
    db_session.add(wt)
    db_session.commit()
    ch = _make_channel(db_session, project_filters=[proj.id])
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock_subprocess_ok()
        result = ingest_event(
            db_session, event_type="Stop",
            payload={"cwd": "/tmp/wt-xyz"},
        )
    assert result["matched"] == 1
    logs = db_session.query(NotificationLog).all()
    assert logs[0].task_id == task.id
    assert logs[0].project_id == proj.id


def test_disabled_channel_is_skipped(db_session):
    _make_channel(db_session, enabled=False)
    result = ingest_event(db_session, event_type="Stop")
    assert result == {"matched": 0, "succeeded": 0, "failed": 0}


# --- helpers --------------------------------------------------------------

class _MockResult:
    returncode = 0


def MagicMock_subprocess_ok():
    """Helper because we can't import MagicMock at module top cleanly in pytest discovery."""
    from unittest.mock import MagicMock
    m = MagicMock()
    m.returncode = 0
    return m
