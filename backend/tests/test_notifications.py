def test_create_notification_on_agent_event(client):
    resp = client.post("/api/v1/agent-events", json={
        "event_type": "Stop",
        "agent": "opencode",
        "message": "task finished",
    })
    assert resp.status_code == 202

    resp = client.get("/api/v1/notifications")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["event_type"] == "Stop"
    assert items[0]["source"] == "opencode"
    assert items[0]["message"] == "task finished"
    assert items[0]["read_at"] is None
    assert items[0]["severity"] == "info"


def test_unread_count(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    client.post("/api/v1/agent-events", json={"event_type": "Notification"})
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})

    resp = client.get("/api/v1/notifications/unread-count")
    assert resp.status_code == 200
    assert resp.json()["count"] == 3


def test_mark_read(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    items = client.get("/api/v1/notifications").json()
    nid = items[0]["id"]

    resp = client.put(f"/api/v1/notifications/{nid}/read")
    assert resp.status_code == 200
    assert resp.json()["read_at"] is not None

    count = client.get("/api/v1/notifications/unread-count").json()
    assert count["count"] == 0

    resp = client.put(f"/api/v1/notifications/{nid}/read")
    assert resp.status_code == 200


def test_mark_all_read(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    client.post("/api/v1/agent-events", json={"event_type": "Notification"})

    resp = client.put("/api/v1/notifications/read-all")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0

    items = client.get("/api/v1/notifications").json()
    assert all(i["read_at"] is not None for i in items)


def test_dismiss_notification(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    items = client.get("/api/v1/notifications").json()
    nid = items[0]["id"]

    resp = client.delete(f"/api/v1/notifications/{nid}")
    assert resp.status_code == 204

    items = client.get("/api/v1/notifications").json()
    assert len(items) == 0


def test_clear_read_notifications(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    client.post("/api/v1/agent-events", json={"event_type": "Notification"})

    items = client.get("/api/v1/notifications").json()
    client.put(f"/api/v1/notifications/{items[0]['id']}/read")

    resp = client.delete("/api/v1/notifications")
    assert resp.status_code == 200

    items = client.get("/api/v1/notifications").json()
    assert len(items) == 1
    assert items[0]["read_at"] is None


def test_unread_only_filter(client):
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})
    client.post("/api/v1/agent-events", json={"event_type": "Notification"})

    items = client.get("/api/v1/notifications").json()
    client.put(f"/api/v1/notifications/{items[0]['id']}/read")

    resp = client.get("/api/v1/notifications?unread_only=true")
    assert resp.status_code == 200
    unread = resp.json()
    assert len(unread) == 1
    assert all(i["read_at"] is None for i in unread)


def test_notification_severity(client):
    client.post("/api/v1/agent-events", json={"event_type": "permission.denied"})
    client.post("/api/v1/agent-events", json={"event_type": "permission.asked"})
    client.post("/api/v1/agent-events", json={"event_type": "Stop"})

    items = client.get("/api/v1/notifications").json()
    by_type = {i["event_type"]: i["severity"] for i in items}
    assert by_type["permission.denied"] == "error"
    assert by_type["permission.asked"] == "warning"
    assert by_type["Stop"] == "info"
