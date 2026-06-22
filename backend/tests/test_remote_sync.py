import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture
def sample_project(client):
    resp = client.post("/api/v1/projects", json={"name": "Sample Project"})
    return resp.json()


@pytest.fixture
def sample_task(client, sample_project):
    resp = client.post(
        f"/api/v1/projects/{sample_project['id']}/tasks",
        json={"title": "Sample Task"},
    )
    return resp.json()


@pytest.fixture
def fake_host():
    host = MagicMock()
    host.ssh_user = "ubuntu"
    host.ssh_host = "10.0.0.5"
    host.ssh_port = 22
    host.base_path_template = "/home/{ssh_user}/deploy/{task_title_slug}"
    host.name = "dev-server"
    return host


@pytest.fixture
def fake_task():
    task = MagicMock()
    task.id = "task-uuid-1234"
    task.title = "Fix Login Bug!"
    task.task_type = "task"
    task.priority = "high"
    task.assignee = "alice"
    return task


@pytest.fixture
def fake_project():
    proj = MagicMock()
    proj.id = "proj-uuid"
    proj.name = "Kanban App"
    return proj


def test_expand_path_template_substitutes_host_vars(fake_task, fake_project, fake_host):
    from app.services.remote_sync_service import expand_path_template

    fake_task.project = fake_project
    result = expand_path_template(
        "/home/{ssh_user}/deploy/{task_title_slug}",
        fake_task,
        fake_host,
    )
    assert result == "/home/ubuntu/deploy/fix-login-bug"


def test_build_rsync_command_key_mode(fake_host):
    """SSH-key mode: -e ssh includes BatchMode=yes, no sshpass prefix."""
    from app.services.remote_sync_service import build_rsync_command

    cmd = build_rsync_command("/src/path", fake_host, "/dest/path", use_password=False)

    assert cmd[0] == "rsync"
    assert "-avz" in cmd
    assert "--delete" in cmd
    # SSH opts must include BatchMode=yes (no password prompt)
    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "BatchMode=yes" in ssh_arg
    assert "StrictHostKeyChecking=accept-new" in ssh_arg
    assert " -p 22 " in ssh_arg
    # Source and dest at the end with trailing slashes
    assert cmd[-2] == "/src/path/"
    assert cmd[-1] == "ubuntu@10.0.0.5:/dest/path/"
    # Excludes
    assert "--exclude=.git/" in cmd
    assert "--exclude=node_modules/" in cmd
    assert "--exclude=__pycache__/" in cmd
    assert "--exclude=*.pyc" in cmd
    assert "--exclude=.venv/" in cmd
    assert "--exclude=dist/" in cmd
    assert "--exclude=build/" in cmd
    assert "--exclude=.DS_Store" in cmd


def test_build_rsync_command_password_mode(fake_host):
    """Password mode: -e ssh must NOT include BatchMode (would block sshpass)."""
    from app.services.remote_sync_service import build_rsync_command

    cmd = build_rsync_command("/src/path", fake_host, "/dest/path", use_password=True)

    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "BatchMode" not in ssh_arg  # Critical: would break sshpass
    assert "StrictHostKeyChecking=accept-new" in ssh_arg


def test_build_rsync_command_custom_port():
    from app.services.remote_sync_service import build_rsync_command

    host = MagicMock()
    host.ssh_user = "u"
    host.ssh_host = "h"
    host.ssh_port = 2222

    cmd = build_rsync_command("/src", host, "/dest", use_password=False)
    ssh_arg = next(arg for arg in cmd if arg.startswith("ssh "))
    assert "-p 2222" in ssh_arg


def test_run_sync_success_no_password(fake_host):
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = "sending incremental file list\n"
    mock_proc.stderr = ""
    mock_proc.returncode = 0

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is True
    assert result["exit_code"] == 0
    assert result["stdout"] == "sending incremental file list\n"
    assert "sshpass" not in result["command"]
    # Env should NOT have SSHPASS
    call_kwargs = mock_run.call_args.kwargs
    assert "SSHPASS" not in call_kwargs.get("env", {})


def test_run_sync_success_with_password(fake_host):
    """Password mode: command prefixed with sshpass, SSHPASS env set on subprocess only."""
    import os
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = ""
    mock_proc.returncode = 0

    parent_env_snapshot = dict(os.environ)

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync("/src", fake_host, "/dest", password="hunter2")

    assert result["success"] is True
    # The argv passed to subprocess must start with sshpass -e
    argv = mock_run.call_args.args[0]
    assert argv[0] == "sshpass"
    assert argv[1] == "-e"
    # SSHPASS must be in subprocess env
    sub_env = mock_run.call_args.kwargs.get("env", {})
    assert sub_env.get("SSHPASS") == "hunter2"
    # Parent process env must be untouched
    assert os.environ == parent_env_snapshot
    # Command echo should NOT include the password
    assert "hunter2" not in result["command"]


def test_run_sync_failure_returns_success_false(fake_host):
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = "Permission denied (publickey).\n"
    mock_proc.returncode = 255

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc):
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is False
    assert result["exit_code"] == 255
    assert "Permission denied" in result["stderr"]


def test_run_sync_timeout(fake_host):
    """Subprocess timeout should surface as a failure, not crash."""
    from app.services.remote_sync_service import run_sync
    from subprocess import TimeoutExpired

    with patch("app.services.remote_sync_service.subprocess.run", side_effect=TimeoutExpired(cmd="rsync", timeout=300)):
        result = run_sync("/src", fake_host, "/dest", password=None)

    assert result["success"] is False
    assert "timed out" in result["stderr"].lower() or "timeout" in result["stderr"].lower()


# ---------------------------------------------------------------------------
# Security: path traversal rejection in run_sync (Finding 3)
# ---------------------------------------------------------------------------

def test_run_sync_rejects_dest_path_traversal(fake_host):
    """A dest_path that escapes its base via '..' must be rejected before subprocess."""
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = "",
    mock_proc.returncode = 0

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync("/src", fake_host, "/home/x/../../etc", password=None)

    assert result["success"] is False
    assert result["exit_code"] == -1
    assert "validation" in result["stderr"].lower() or ".." in result["stderr"]
    # Critical: subprocess must never have been invoked
    mock_run.assert_not_called()


def test_run_sync_rejects_src_path_traversal(fake_host):
    """Defense in depth: src_path with traversal must also be rejected."""
    from app.services.remote_sync_service import run_sync

    with patch("app.services.remote_sync_service.subprocess.run") as mock_run:
        result = run_sync("/src/../../etc", fake_host, "/dest", password=None)

    assert result["success"] is False
    assert "validation" in result["stderr"].lower() or ".." in result["stderr"]
    mock_run.assert_not_called()


def test_run_sync_rejects_backslash_in_dest(fake_host):
    """Backslash in dest_path could be interpreted by some shells/clients — reject."""
    from app.services.remote_sync_service import run_sync

    with patch("app.services.remote_sync_service.subprocess.run") as mock_run:
        result = run_sync("/src", fake_host, "/home/x\\evil", password=None)

    assert result["success"] is False
    mock_run.assert_not_called()


def test_run_sync_accepts_safe_absolute_path(fake_host):
    """Regression: legitimate absolute paths must still pass validation."""
    from app.services.remote_sync_service import run_sync

    mock_proc = MagicMock()
    mock_proc.stdout = ""
    mock_proc.stderr = ""
    mock_proc.returncode = 0

    with patch("app.services.remote_sync_service.subprocess.run", return_value=mock_proc) as mock_run:
        result = run_sync(
            "/home/user/deploy/task",
            fake_host,
            "/home/ubuntu/deploy/fix-login-bug",
            password=None,
        )

    assert result["success"] is True
    mock_run.assert_called_once()


def test_validate_path_safe_helper_unit():
    """Direct unit test of the helper for clarity."""
    from app.services.remote_sync_service import validate_path_safe, UnsafePathError

    # Safe paths
    validate_path_safe("/home/user/deploy/task")
    validate_path_safe("/srv/app/fix-login-bug")
    validate_path_safe("relative/path")

    # Unsafe paths
    for bad in ("/home/x/../../etc", "../../etc", "/..", "/a/../..", ".."):
        with pytest.raises(UnsafePathError):
            validate_path_safe(bad, "dest_path")

    # Backslash
    with pytest.raises(UnsafePathError):
        validate_path_safe("/home/x\\y", "dest_path")

    # Empty
    with pytest.raises(UnsafePathError):
        validate_path_safe("", "dest_path")


# ---------------------------------------------------------------------------
# API: POST /api/v1/tasks/{task_id}/sync (Task 6)
# ---------------------------------------------------------------------------


def test_sync_endpoint_no_worktree(client, sample_task):
    """Task without a worktree should return 400."""
    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/sync", json={})
    assert resp.status_code == 400
    assert "worktree" in resp.json()["detail"].lower()


def test_sync_endpoint_no_host_configured(client, sample_task):
    """Task with no remote_host_id and no host_id in body should return 400."""
    # Give the task a worktree so we get past that check.
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(
            task_id=task.id,
            branch="test-branch",
            path="/tmp/fake-worktree",
            status="active",
        )
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
    finally:
        db.close()

    resp = client.post(f"/api/v1/tasks/{sample_task['id']}/sync", json={})
    assert resp.status_code == 400
    assert "remote host" in resp.json()["detail"].lower()


def test_sync_endpoint_host_not_found(client, sample_task):
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/x", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
    finally:
        db.close()

    resp = client.post(
        f"/api/v1/tasks/{sample_task['id']}/sync",
        json={"host_id": "nonexistent"},
    )
    assert resp.status_code == 404


def test_sync_endpoint_happy_path(client, sample_task):
    """Successful sync returns SyncResponse and writes activity log."""
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task
    from app.models.activity_log import ActivityLog

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/myworktree", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
        task_id = task.id
    finally:
        db.close()

    host = client.post("/api/v1/remote-hosts", json={
        "name": "dev",
        "ssh_user": "ubuntu",
        "ssh_host": "10.0.0.5",
        "base_path_template": "/home/{ssh_user}/deploy/{task_title_slug}",
    }).json()

    mock_result = {
        "success": True,
        "stdout": "sent 100 bytes",
        "stderr": "",
        "exit_code": 0,
        "command": "rsync -avz ...",
    }
    with patch("app.routers.tasks.run_sync", return_value=mock_result):
        resp = client.post(
            f"/api/v1/tasks/{task_id}/sync",
            json={"host_id": host["id"]},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["host_name"] == "dev"
    assert data["dest_path"].startswith("/home/ubuntu/deploy/")

    # Verify activity log entry
    db = SessionLocal()
    try:
        log = db.query(ActivityLog).filter(
            ActivityLog.entity_id == task_id,
            ActivityLog.event_type == "task.synced",
        ).first()
        assert log is not None
        assert "dev" in log.detail
        # extra_data must not contain any password value. We sent no password
        # in this test, so the only "password" token allowed is the boolean
        # flag key `using_password`. Parse the JSON and assert no password-
        # bearing *value* is present.
        import json as _json
        extra = _json.loads(log.extra_data) if log.extra_data else {}
        assert set(extra.keys()) <= {"success", "exit_code", "using_password", "host_id"}
        # No "password" key (only the boolean "using_password" flag is allowed).
        assert "password" not in extra
    finally:
        db.close()


def test_sync_endpoint_password_not_in_response(client, sample_task):
    """Password from request must not leak into response."""
    from app.database import SessionLocal
    from app.models.worktree import Worktree
    from app.models.task import Task

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == sample_task["id"]).first()
        wt = Worktree(task_id=task.id, branch="b", path="/tmp/wt", status="active")
        db.add(wt)
        db.flush()
        task.worktree_id = wt.id
        db.commit()
        task_id = task.id
    finally:
        db.close()

    host = client.post("/api/v1/remote-hosts", json={
        "name": "dev",
        "ssh_user": "u",
        "ssh_host": "h",
        "base_path_template": "/x",
    }).json()

    mock_result = {
        "success": True, "stdout": "", "stderr": "", "exit_code": 0, "command": "rsync",
    }
    with patch("app.routers.tasks.run_sync", return_value=mock_result) as mock_fn:
        resp = client.post(f"/api/v1/tasks/{task_id}/sync", json={
            "host_id": host["id"],
            "password": "super-secret-pw",
        })

    assert resp.status_code == 200
    # Password must not appear in response body anywhere
    assert "super-secret-pw" not in resp.text
    # The service must have been called with the password
    mock_fn.assert_called_once()
    assert mock_fn.call_args.kwargs.get("password") == "super-secret-pw"
