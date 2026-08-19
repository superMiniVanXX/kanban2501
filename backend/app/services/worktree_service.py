import logging
import os
import platform
import subprocess
from pathlib import Path
import re

logger = logging.getLogger(__name__)


def _slugify(value: str) -> str:
    # Keep Unicode word characters (letters/digits incl. CJK) so Chinese project
    # names survive; only replace shell-unsafe separators (spaces, punctuation,
    # arrows, full-width colons …) with '-'. Pure-ASCII slug would erase CJK
    # entirely and produce empty/ambiguous directory names.
    return re.sub(r"[^\w]+", "-", value, flags=re.UNICODE).strip("-").lower()[:60]


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


def import_worktree(path: str) -> dict:
    """Associate an EXISTING directory with a task as its worktree.

    Unlike create_worktree this does NOT run `git worktree add` — the
    directory already exists on disk (user-created). We only validate the
    path and, if it happens to be a git repository, read its current branch
    so the record carries useful info. Plain folders (no .git) are allowed:
    branch is left empty and the user manages git state themselves.

    Returns {"success": True, "branch": str | None} on success.
    """
    target = Path(path).resolve()
    if not target.exists():
        return {"success": False, "error": f"Path does not exist: {target}"}
    if not target.is_dir():
        return {"success": False, "error": f"Path is not a directory: {target}"}

    branch: str | None = None
    if (target / ".git").exists() or (target / ".git").is_file():
        try:
            result = subprocess.run(
                ["git", "-C", str(target), "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                branch = result.stdout.strip() or None
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass  # non-git dir or git missing — branch stays None

    logger.info("Imported existing worktree: path=%s branch=%s", target, branch)
    return {"success": True, "branch": branch, "error": None}


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
