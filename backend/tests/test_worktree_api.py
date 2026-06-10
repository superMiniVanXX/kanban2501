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
        "description": "Feature branch worktree config",
        "auto_cleanup": False,
    })
    return resp.json()


def test_create_worktree_config(client):
    resp = client.post("/api/v1/worktree-configs", json={
        "name": "Test Config",
        "branch_template": "feature/{task_id_short}",
        "dir_template": "/tmp/wt/{branch_name}",
        "base_repo_path": "/tmp/repo",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Config"
    assert data["auto_cleanup"] is False


def test_list_worktree_configs(client, sample_wt_config):
    resp = client.get("/api/v1/worktree-configs")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_update_worktree_config(client, sample_wt_config):
    resp = client.put(f"/api/v1/worktree-configs/{sample_wt_config['id']}", json={
        "name": "Updated Config",
        "auto_cleanup": True,
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Config"
    assert resp.json()["auto_cleanup"] is True


def test_delete_worktree_config(client, sample_wt_config):
    resp = client.delete(f"/api/v1/worktree-configs/{sample_wt_config['id']}")
    assert resp.status_code == 204


def test_create_task_with_worktree_config(client, sample_project, sample_wt_config):
    resp = client.post(f"/api/v1/projects/{sample_project['id']}/tasks", json={
        "title": "Task with Worktree",
        "worktree_config_id": sample_wt_config["id"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["worktree"] is not None
    assert data["worktree"]["status"] == "pending"


def test_task_response_includes_worktree_none(client, sample_task):
    assert sample_task["worktree"] is None


def test_worktree_config_not_found(client, sample_task):
    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/worktree", json={
        "config_id": "nonexistent-id",
    })
    assert resp.status_code == 404
