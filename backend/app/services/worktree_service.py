import logging
import subprocess
from pathlib import Path
import re

logger = logging.getLogger(__name__)


def expand_template(template: str, task, project, branch: str | None = None) -> str:
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', task.title).strip('-').lower()[:60]
    variables = {
        "{task_id}": task.id,
        "{task_id_short}": task.id[:8],
        "{task_title}": task.title,
        "{task_title_slug}": slug,
        "{task_type}": task.task_type or "",
        "{task_priority}": task.priority or "",
        "{task_assignee}": task.assignee or "",
        "{project_id}": project.id,
        "{project_name}": project.name,
    }
    if branch:
        variables["{branch_name}"] = branch
    result = template
    for token, value in variables.items():
        result = result.replace(token, value)
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
