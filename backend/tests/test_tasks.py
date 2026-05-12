import pytest


@pytest.fixture
def project_id(client):
    resp = client.post("/api/v1/projects", json={"name": "P1"})
    return resp.json()["id"]


def test_create_task(client, project_id):
    resp = client.post(f"/api/v1/projects/{project_id}/tasks", json={
        "title": "Task 1",
        "priority": "high",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Task 1"
    assert data["status"] == "backlog"
    assert data["priority"] == "high"


def test_list_tasks(client, project_id):
    client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T2"})
    resp = client.get(f"/api/v1/projects/{project_id}/tasks")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_filter_tasks_by_status(client, project_id):
    r1 = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    tid = r1.json()["id"]
    client.put(f"/api/v1/tasks/{tid}/status", json={"status": "in_progress"})
    resp = client.get(f"/api/v1/projects/{project_id}/tasks", params={"status": "in_progress"})
    assert len(resp.json()) == 1


def test_update_task(client, project_id):
    create = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "Old"})
    tid = create.json()["id"]
    resp = client.put(f"/api/v1/tasks/{tid}", json={"title": "New", "progress": 50})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New"
    assert resp.json()["progress"] == 50


def test_change_task_status(client, project_id):
    create = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    tid = create.json()["id"]
    resp = client.put(f"/api/v1/tasks/{tid}/status", json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


def test_move_task_sort_order(client, project_id):
    create = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    tid = create.json()["id"]
    resp = client.put(f"/api/v1/tasks/{tid}/move", json={"sort_order": 5})
    assert resp.status_code == 200
    assert resp.json()["sort_order"] == 5


def test_delete_task(client, project_id):
    create = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    tid = create.json()["id"]
    resp = client.delete(f"/api/v1/tasks/{tid}")
    assert resp.status_code == 204
