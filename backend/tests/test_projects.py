def test_create_project(client):
    resp = client.post("/api/v1/projects", json={
        "name": "My Project",
        "description": "A test project",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Project"
    assert data["status"] == "planning"
    assert data["id"] is not None


def test_list_projects(client):
    client.post("/api/v1/projects", json={"name": "P1"})
    client.post("/api/v1/projects", json={"name": "P2"})
    resp = client.get("/api/v1/projects")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_project(client):
    create = client.post("/api/v1/projects", json={"name": "P1"})
    pid = create.json()["id"]
    resp = client.get(f"/api/v1/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "P1"


def test_update_project(client):
    create = client.post("/api/v1/projects", json={"name": "Old"})
    pid = create.json()["id"]
    resp = client.put(f"/api/v1/projects/{pid}", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


def test_delete_project(client):
    create = client.post("/api/v1/projects", json={"name": "P1"})
    pid = create.json()["id"]
    resp = client.delete(f"/api/v1/projects/{pid}")
    assert resp.status_code == 204
    resp = client.get(f"/api/v1/projects/{pid}")
    assert resp.status_code == 404


def test_update_project_status(client):
    create = client.post("/api/v1/projects", json={"name": "P1"})
    pid = create.json()["id"]
    resp = client.put(f"/api/v1/projects/{pid}/status", json={"status": "active"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"
