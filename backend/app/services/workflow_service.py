from app.models.task import Task

# Linear forward flow — only adjacent transitions allowed
FORWARD_OK = {
    ("backlog", "todo"),
    ("todo", "in_progress"),
    ("in_progress", "review"),
    ("review", "done"),
    ("done", "verify"),
    ("verify", "complete"),
}

# Backward moves always allowed
BACKWARD_OK = {
    ("todo", "backlog"),
    ("in_progress", "todo"),
    ("review", "in_progress"),
    ("done", "review"),
    ("verify", "done"),
    ("complete", "verify"),
    ("cancelled", "backlog"),
}


def validate_transition(task: Task, new_status: str) -> str | None:
    if task.status == new_status:
        return None

    transition = (task.status, new_status)

    # Cancel from any status
    if new_status == "cancelled":
        return None

    # Backward moves
    if transition in BACKWARD_OK:
        return None

    # Forward moves
    if transition in FORWARD_OK:
        if task.status == "backlog" and new_status == "todo":
            if not task.implementation_plan or not task.implementation_plan.strip():
                return "Cannot move task to 'To Do': implementation_plan is required. Please fill in the implementation plan first."
        return None

    # Everything else is blocked
    status_labels = {
        "backlog": "Backlog", "todo": "To Do", "in_progress": "In Progress",
        "review": "Review", "done": "Done", "verify": "Verify",
        "complete": "Complete", "cancelled": "Cancelled",
    }
    src = status_labels.get(task.status, task.status)
    dst = status_labels.get(new_status, new_status)
    return f"Cannot move task from '{src}' to '{dst}': only adjacent stage transitions are allowed."
