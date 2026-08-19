from unittest.mock import patch, MagicMock


def test_create_channel_validates_config(client):
    resp = client.post("/api/v1/notification-channels", json={
        "name": "bad-email",
        "channel_type": "email",
        "config": {"smtp_host": "h"},  # missing required fields
    })
    assert resp.status_code == 422


def test_create_and_list_channel(client):
    resp = client.post("/api/v1/notification-channels", json={
        "name": "Desktop",
        "channel_type": "desktop",
        "config": {},
        "event_filters": ["Stop", "task.done"],
    })
    assert resp.status_code == 201
    created = resp.json()
    assert created["id"]
    assert created["config"] == {"command": "notify-send"}
    assert created["event_filters"] == ["Stop", "task.done"]

    listing = client.get("/api/v1/notification-channels")
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_update_channel(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    resp = client.put(f"/api/v1/notification-channels/{cid}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_delete_channel_soft_deletes(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    resp = client.delete(f"/api/v1/notification-channels/{cid}")
    assert resp.status_code == 204
    # Listing excludes soft-deleted
    listing = client.get("/api/v1/notification-channels").json()
    assert len(listing) == 0


def test_test_channel_endpoint_dispatches(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        resp = client.post(f"/api/v1/notification-channels/{cid}/test")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"


def test_logs_endpoint_returns_recent(client):
    create = client.post("/api/v1/notification-channels", json={
        "name": "x", "channel_type": "desktop", "config": {},
    })
    cid = create.json()["id"]
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        client.post(f"/api/v1/notification-channels/{cid}/test")
    logs = client.get("/api/v1/notification-logs").json()
    assert len(logs) >= 1
    assert logs[0]["status"] == "success"
