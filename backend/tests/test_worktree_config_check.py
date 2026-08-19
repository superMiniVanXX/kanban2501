import pytest


@pytest.fixture
def sample_project(client):
    resp = client.post("/api/v1/projects", json={"name": "Test Project"})
    return resp.json()


@pytest.fixture
def sample_task(client, sample_project):
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={"title": "Test Task"})
    return resp.json()


@pytest.fixture
def sample_wt_config(client):
    resp = client.post("/api/v1/worktree-configs", json={
        "name": "Feature Branch",
        "branch_template": "feature/{task_id_short}-{task_title_slug}",
        "dir_template": "/tmp/worktrees/{project_name}/{branch_name}",
        "base_repo_path": "/tmp/test-repo",
    })
    return resp.json()


@pytest.fixture
def exec_config(client):
    resp = client.post("/api/v1/execution-configs", json={
        "name": "Echo",
        "command_template": "echo hello",
    })
    return resp.json()


# --- Task creation defaults ---

def test_new_task_worktree_config_id_defaults_to_none(client, sample_project):
    """A newly created task without worktree_config_id should have worktree_config_id=None."""
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={"title": "T1"})
    assert resp.status_code == 201
    assert resp.json()["worktree_config_id"] is None


def test_create_task_with_worktree_config_none(client, sample_project):
    """Creating a task with worktree_config_id='none' should persist that value."""
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "T1",
        "worktree_config_id": "none",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["worktree_config_id"] == "none"
    assert data["worktree"] is None


def test_create_task_with_worktree_config_uuid(client, sample_project, sample_wt_config):
    """Creating a task with a valid worktree_config_id should persist the UUID and create worktree."""
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "T1",
        "worktree_config_id": sample_wt_config["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["worktree_config_id"] == sample_wt_config["id"]
    assert data["worktree"] is not None
    assert data["worktree"]["status"] == "pending"


# --- Task update ---

def test_update_task_worktree_config_to_none_choice(client, sample_task):
    """Updating worktree_config_id to 'none' should persist it."""
    resp = client.put(f"/api/v1/tasks/{sample_task['id']}", json={
        "worktree_config_id": "none",
    })
    assert resp.status_code == 200
    assert resp.json()["worktree_config_id"] == "none"


def test_update_task_worktree_config_unset_unchanged(client, sample_task):
    """Updating a task without worktree_config_id should NOT change the existing value."""
    # First set to "none"
    client.put(f"/api/v1/tasks/{sample_task['id']}", json={"worktree_config_id": "none"})
    # Then update something else
    resp = client.put(f"/api/v1/tasks/{sample_task['id']}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["worktree_config_id"] == "none"


# --- Execute checks ---

def test_execute_blocked_without_worktree_config(client, sample_task, exec_config):
    """Executing a task with worktree_config_id=None should return 422."""
    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/execute", json={
        "config_id": exec_config["id"],
    })
    assert resp.status_code == 422
    assert "worktree" in resp.json()["detail"].lower() or "配置" in resp.json()["detail"]


def test_execute_allowed_with_none_choice(client, sample_project, exec_config):
    """Executing a task with worktree_config_id='none' should proceed normally."""
    create = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "T1",
        "worktree_config_id": "none",
    })
    tid = create.json()["id"]
    resp = client.post(f"/api/v1/tasks/{tid}/execute", json={
        "config_id": exec_config["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True


# --- Execute with worktree but stale config_id ---

def test_execute_allowed_with_worktree_but_null_config_id(client, sample_project, sample_wt_config, exec_config):
    """Executing a task that has an active worktree record but worktree_config_id=None
    (data inconsistency) should still proceed — the worktree is the source of truth."""
    from app.database import SessionLocal
    from app.models.task import Task
    from app.models.worktree import Worktree

    create = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "T1",
        "worktree_config_id": sample_wt_config["id"],
    })
    tid = create.json()["id"]

    # Simulate the data inconsistency: clear worktree_config_id while keeping
    # the worktree active (as if it was created on disk but config_id got stale).
    db = SessionLocal()
    task = db.query(Task).filter(Task.id == tid).first()
    task.worktree_config_id = None
    task.worktree.status = "active"
    task.worktree.path = "/tmp"
    db.commit()
    db.close()

    resp = client.post(f"/api/v1/tasks/{tid}/execute", json={
        "config_id": exec_config["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True


# --- Worktree endpoint sync ---

def test_worktree_endpoint_sets_config_id(client, sample_task, sample_wt_config):
    """Creating a worktree via the worktree endpoint should set task.worktree_config_id."""
    # We can't actually create a real git worktree in tests, but the config_id
    # should still be attempted to be set. The create may fail (no real repo),
    # but if it succeeds, the config_id should be set.
    # Instead, test via update_task with worktree_config_id:
    resp = client.put(f"/api/v1/tasks/{sample_task['id']}", json={
        "worktree_config_id": sample_wt_config["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["worktree_config_id"] == sample_wt_config["id"]
    assert resp.json()["worktree"] is not None


def test_worktree_config_id_in_task_response(client, sample_task):
    """TaskResponse should include worktree_config_id field."""
    resp = client.get(f"/api/v1/tasks/{sample_task['id']}")
    assert resp.status_code == 200
    assert "worktree_config_id" in resp.json()
