"""Service for rsync-ing a task's worktree contents to a remote host."""
import os
import posixpath
import shutil
import subprocess
from subprocess import TimeoutExpired

from app.services.worktree_service import expand_template


RSYNC_TIMEOUT_SECONDS = 300


class UnsafePathError(ValueError):
    """Raised when an expanded path contains traversal components."""


def validate_path_safe(path: str, field_name: str = "path") -> None:
    """Reject paths containing '..' components or other traversal patterns.

    rsync destinations are remote paths; we use posixpath (forward slashes)
    regardless of local OS. Two-pronged check:

      1. Reject any '..' segment in the *original* path — this catches cases
         like '/home/x/../../etc' (normalizes to '/etc' but the user clearly
         intended to traverse out of '/home/x').
      2. Reject if the *normalized* path escapes upward (starts with '..' or
         equals '..') — catches relative traversals like '../../etc'.
    """
    if not path:
        raise UnsafePathError(f"{field_name} is empty")
    # Check 1: any '..' segment in the original path.
    segments = path.split("/")
    if ".." in segments:
        raise UnsafePathError(
            f"{field_name} contains '..' traversal components: {path!r}"
        )
    # Check 2: normalized form must not escape upward.
    normalized = posixpath.normpath(path)
    if normalized == ".." or normalized.startswith("../"):
        raise UnsafePathError(
            f"{field_name} contains '..' traversal components: {path!r}"
        )
    # Reject backslashes too (could be interpreted by some shells/clients)
    if "\\" in path:
        raise UnsafePathError(f"{field_name} contains backslash: {path!r}")


DEFAULT_EXCLUDES = [
    ".git/",
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    ".venv/",
    "dist/",
    "build/",
    ".DS_Store",
]


def expand_path_template(template: str, task, host, branch: str | None = None) -> str:
    """Expand host.base_path_template using task, project, and host variables."""
    extra_vars = {
        "{ssh_user}": host.ssh_user,
        "{ssh_host}": host.ssh_host,
    }
    return expand_template(template, task, task.project, branch=branch, extra_vars=extra_vars)


def build_rsync_command(src_path: str, host, dest_path: str, *, use_password: bool) -> list[str]:
    """Build the rsync argv list. If use_password=True, omit BatchMode so sshpass can intercept."""
    ssh_opts = ["ssh", "-p", str(host.ssh_port), "-o", "StrictHostKeyChecking=accept-new"]
    if not use_password:
        ssh_opts.append("-o")
        ssh_opts.append("BatchMode=yes")

    cmd = ["rsync", "-avz", "--delete", "-e", " ".join(ssh_opts)]
    for exclude in DEFAULT_EXCLUDES:
        cmd.append(f"--exclude={exclude}")
    cmd.append(src_path.rstrip("/") + "/")
    cmd.append(f"{host.ssh_user}@{host.ssh_host}:{dest_path.rstrip('/')}/")
    return cmd


def _format_command_for_display(argv: list[str]) -> str:
    """Human-readable command. We strip the password (caller passes sshpass -e form which uses env var, not -p)."""
    return " ".join(argv)


def run_sync(src_path: str, host, dest_path: str, password: str | None = None) -> dict:
    """Execute rsync. Returns dict with keys: success, stdout, stderr, exit_code, command.

    If password is provided, prepends `sshpass -e` and sets SSHPASS env var on the
    subprocess only (never propagates to parent process).
    """
    use_password = bool(password)

    if use_password and not shutil.which("sshpass"):
        return {
            "success": False,
            "stdout": "",
            "stderr": "`sshpass` is not installed on the server. Install with `apt install sshpass` (or equivalent) to use password authentication.",
            "exit_code": -1,
            "command": "",
        }

    if not shutil.which("rsync"):
        return {
            "success": False,
            "stdout": "",
            "stderr": "`rsync` is not installed on the server. Install with `apt install rsync` (or equivalent).",
            "exit_code": -1,
            "command": "",
        }

    # Security (Finding 3): defend against path traversal via user-controlled
    # template variables ({task_title}, {project_name}, {branch_name}). Reject
    # before we build the rsync argv or invoke subprocess.
    try:
        validate_path_safe(src_path, "src_path")
        validate_path_safe(dest_path, "dest_path")
    except UnsafePathError as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Path validation failed: {e}",
            "exit_code": -1,
            "command": "",
        }

    rsync_argv = build_rsync_command(src_path, host, dest_path, use_password=use_password)

    if use_password:
        argv = ["sshpass", "-e"] + rsync_argv
        sub_env = dict(os.environ)
        sub_env["SSHPASS"] = password
    else:
        argv = rsync_argv
        sub_env = os.environ.copy()  # Copy parent env without SSHPASS

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=RSYNC_TIMEOUT_SECONDS,
            env=sub_env,
        )
        return {
            "success": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exit_code": proc.returncode,
            "command": _format_command_for_display(rsync_argv),  # NOTE: never includes password
        }
    except TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"rsync timed out after {RSYNC_TIMEOUT_SECONDS} seconds.",
            "exit_code": -1,
            "command": _format_command_for_display(rsync_argv),
        }
