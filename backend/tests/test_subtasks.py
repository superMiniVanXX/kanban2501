import pytest


@pytest.fixture
def project_id(client):
    resp = client.post("/api/v1/projects", json={"name": "P1"})
    return resp.json()["id"]


@pytest.fixture
def task_id(client, project_id):
    resp = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "T1"})
    return resp.json()["id"]


def test_create_subtask(client, task_id):
    resp = client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "Sub 1"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Sub 1"
    assert data["done"] is False
    assert data["task_id"] == task_id


def test_list_subtasks(client, task_id):
    client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S1"})
    client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S2"})
    resp = client.get(f"/api/v1/tasks/{task_id}/subtasks")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_toggle_subtask_done(client, task_id):
    create = client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S1"})
    sid = create.json()["id"]
    resp = client.put(f"/api/v1/subtasks/{sid}", json={"done": True})
    assert resp.status_code == 200
    assert resp.json()["done"] is True


def test_progress_auto_calculated(client, task_id):
    client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S1"})
    r2 = client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S2"})
    sid2 = r2.json()["id"]

    # toggle one done → progress = 50%
    client.put(f"/api/v1/subtasks/{sid2}", json={"done": True})
    resp = client.get(f"/api/v1/tasks/{task_id}")
    assert resp.json()["progress"] == 50


def test_delete_subtask_recalcs(client, task_id):
    r1 = client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S1"})
    r2 = client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "S2"})
    client.put(f"/api/v1/subtasks/{r1.json()['id']}", json={"done": True})

    # progress = 50% (1 of 2 done)
    assert client.get(f"/api/v1/tasks/{task_id}").json()["progress"] == 50

    # delete the done one → 0 of 1 done → 0%
    client.delete(f"/api/v1/subtasks/{r1.json()['id']}")
    assert client.get(f"/api/v1/tasks/{task_id}").json()["progress"] == 0


def test_subtasks_in_board_response(client, project_id, task_id):
    client.post(f"/api/v1/tasks/{task_id}/subtasks", json={"title": "Sub A"})
    resp = client.get(f"/api/v1/projects/{project_id}/board")
    data = resp.json()
    backlog_col = next(c for c in data["columns"] if c["column_status"] == "backlog")
    task_data = backlog_col["tasks"][0]
    assert len(task_data["subtasks"]) == 1
    assert task_data["subtasks"][0]["title"] == "Sub A"
