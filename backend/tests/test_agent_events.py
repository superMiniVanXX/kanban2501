from unittest.mock import patch


def test_agent_event_claude_code_raw_stdin(client):
    # Simulate the exact payload Claude Code pipes to a hook command.
    resp = client.post("/api/v1/agent-events", json={
        "hook_event_name": "Stop",
        "session_id": "abc",
        "cwd": "/home/u/wt",
        "transcript_path": "/home/u/.claude/projects/x/y.jsonl",
    })
    assert resp.status_code == 202
    body = resp.json()
    assert "matched" in body
    assert body["matched"] == 0  # no channels configured


def test_agent_event_explicit_event_type(client):
    resp = client.post("/api/v1/agent-events", json={
        "event_type": "agent.stop",
        "agent": "opencode",
        "message": "done",
    })
    assert resp.status_code == 202


def test_agent_event_unknown_task_id_returns_400(client):
    resp = client.post("/api/v1/agent-events", json={
        "event_type": "Stop",
        "task_id": "does-not-exist-1234",
    })
    assert resp.status_code == 400


def test_agent_event_missing_event_type_returns_400(client):
    resp = client.post("/api/v1/agent-events", json={})
    assert resp.status_code == 400


def test_agent_event_fires_channel_and_returns_log_id(client):
    from unittest.mock import MagicMock
    # Create a channel
    client.post("/api/v1/notification-channels", json={
        "name": "desktop",
        "channel_type": "desktop",
        "config": {},
    })
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        resp = client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    assert resp.status_code == 202
    body = resp.json()
    assert body["matched"] == 1
    assert body["succeeded"] == 1
    assert len(body["log_ids"]) == 1
