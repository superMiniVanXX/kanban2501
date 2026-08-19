from unittest.mock import patch, MagicMock


def _seed_task_with_implementation_plan(client, db_session):
    from app.models.project import Project
    from app.models.task import Task
    proj = Project(name="P")
    db_session.add(proj)
    db_session.commit()
    db_session.refresh(proj)
    task = Task(project_id=proj.id, title="T", implementation_plan="plan")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return proj.id, task.id


def test_task_transition_to_done_fires_task_done_event(client, db_session):
    proj_id, task_id = _seed_task_with_implementation_plan(client, db_session)
    # Create a channel that listens for task.done
    client.post("/api/v1/notification-channels", json={
        "name": "done-listener",
        "channel_type": "desktop",
        "config": {},
        "event_filters": ["task.done"],
    })
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        # Move task backlog -> todo -> in_progress -> review -> done
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "todo"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "in_progress"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "review"})
        resp = client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "done"})
    assert resp.status_code == 200
    # Verify dispatch happened: the channel fired once for task.review + once for task.done
    # but the channel only matches task.done, so only one success log.
    logs = client.get("/api/v1/notification-logs").json()
    successes = [log for log in logs if log["status"] == "success" and log["event_type"] == "task.done"]
    assert len(successes) == 1


def test_task_transition_to_backlog_does_not_fire(client, db_session):
    proj_id, task_id = _seed_task_with_implementation_plan(client, db_session)
    client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    with patch("app.services.notification_senders.desktop.subprocess.run"):
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "todo"})
        client.put(f"/api/v1/tasks/{task_id}/status", json={"status": "backlog"})
    logs = client.get("/api/v1/notification-logs").json()
    assert len(logs) == 0
