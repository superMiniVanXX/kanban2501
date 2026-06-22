import logging
import os
import platform
import subprocess
from pathlib import Path
import re

logger = logging.getLogger(__name__)


def _slugify(value: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', value).strip('-').lower()[:60]


def expand_template(
    template: str,
    task,
    project,
    branch: str | None = None,
    extra_vars: dict[str, str] | None = None,
) -> str:
    variables = {
        "{task_id}": task.id,
        "{task_id_short}": task.id[:8],
        "{task_title}": task.title,
        "{task_title_slug}": _slugify(task.title),
        "{task_type}": task.task_type or "",
        "{task_priority}": task.priority or "",
        "{task_assignee}": task.assignee or "",
        "{project_id}": project.id,
        "{project_name}": project.name,
        "{project_slug}": _slugify(project.name),
    }
    if branch:
        variables["{branch_name}"] = branch
    if extra_vars:
        variables.update(extra_vars)
    result = template
    for token, value in variables.items():
        result = result.replace(token, str(value))
    return result


def validate_repo(path: str) -> dict:
    result = {"valid": False, "error": None}
    try:
        completed = subprocess.run(
            ["git", "-C", path, "rev-parse", "--git-dir"],
            capture_output=True, text=True, timeout=5,
        )
        if completed.returncode == 0:
            result["valid"] = True
        else:
            result["error"] = f"Not a git repository: {completed.stderr.strip()}"
    except FileNotFoundError:
        result["error"] = "git command not found"
    except subprocess.TimeoutExpired:
        result["error"] = "git command timed out"
    except Exception as e:
        result["error"] = str(e)
    return result


def create_worktree(base_repo: str, branch: str, target_path: str) -> dict:
    base = Path(base_repo).resolve()
    target = Path(target_path).resolve()

    try:
        target.relative_to(base)
        return {"success": False, "error": f"Target path '{target}' is inside the base repository '{base}'"}
    except ValueError:
        pass

    if target.exists():
        return {"success": False, "error": f"Target path already exists: {target}"}

    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(
            ["git", "-C", str(base), "worktree", "add", "-b", branch, str(target)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            logger.info("Created worktree: branch=%s path=%s", branch, target)
            return {"success": True, "error": None}
        else:
            error = result.stderr.strip() or result.stdout.strip()
            logger.warning("git worktree add failed: %s", error)
            return {"success": False, "error": error}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "git worktree add timed out after 10 seconds"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def remove_worktree(path: str) -> dict:
    target = Path(path).resolve()

    try:
        result = subprocess.run(
            ["git", "worktree", "remove", str(target)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            logger.info("Removed worktree: path=%s", target)
            return {"success": True, "error": None}
        else:
            error = result.stderr.strip() or result.stdout.strip()
            logger.warning("git worktree remove failed: %s", error)
            return {"success": False, "error": error}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "git worktree remove timed out after 10 seconds"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def open_worktree(path: str) -> dict:
    p = Path(path).resolve()
    if not p.exists():
        return {"success": False, "error": f"Path does not exist: {p}"}

    system = platform.system()
    try:
        if system == "Linux":
            subprocess.run(["xdg-open", str(p)], check=False, timeout=5)
        elif system == "Darwin":
            subprocess.run(["open", str(p)], check=False, timeout=5)
        elif system == "Windows":
            os.startfile(str(p))  # no shell, safe from command injection
        else:
            return {"success": False, "error": f"Unsupported platform: {system}"}
        logger.info("Opened worktree path: %s", p)
        return {"success": True, "error": None}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Open command timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}
