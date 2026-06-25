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


def _seed_task(db, project_id, title, status):
    """Insert a Task row directly, bypassing the workflow transitions."""
    from app.models.task import Task
    t = Task(id=title, project_id=project_id, title=title, status=status)
    db.add(t)
    db.commit()
    return t


def test_project_tree_task_counts_aggregates_across_children(client):
    """Parent's task_counts must include own tasks + all descendant tasks,
    and `total` must include cancelled tasks."""
    from app.database import SessionLocal

    parent = client.post("/api/v1/projects", json={"name": "Parent"}).json()
    child = client.post("/api/v1/projects", json={
        "name": "Child", "parent_id": parent["id"],
    }).json()

    db = SessionLocal()
    try:
        # Parent's own tasks
        _seed_task(db, parent["id"], "p-backlog-1", "backlog")
        _seed_task(db, parent["id"], "p-todo-1", "todo")
        _seed_task(db, parent["id"], "p-cancelled-1", "cancelled")
        # Child's tasks
        _seed_task(db, child["id"], "c-inprog-1", "in_progress")
        _seed_task(db, child["id"], "c-done-1", "done")
        _seed_task(db, child["id"], "c-cancelled-1", "cancelled")
    finally:
        db.close()

    tree = client.get("/api/v1/projects/tree").json()
    parent_node = next(p for p in tree if p["id"] == parent["id"])
    counts = parent_node["task_counts"]

    assert counts["backlog"] == 1
    assert counts["todo"] == 1
    assert counts["in_progress"] == 1
    assert counts["done"] == 1
    assert counts["cancelled"] == 2  # parent + child
    assert counts["total"] == 6     # all tasks incl. cancelled


def test_project_tree_task_counts_zero_for_empty_project(client):
    """A project with no tasks should return all-zero counts."""
    resp = client.post("/api/v1/projects", json={"name": "Empty"})
    pid = resp.json()["id"]

    tree = client.get("/api/v1/projects/tree").json()
    node = next(p for p in tree if p["id"] == pid)
    counts = node["task_counts"]

    assert counts["total"] == 0
    assert counts["backlog"] == 0
    assert counts["cancelled"] == 0
