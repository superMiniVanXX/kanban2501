from sqlalchemy.orm import Session

from app.models.project import Project


def build_project_tree(all_projects: list[Project], completion_map: dict[str, bool] | None = None, task_stats: dict[str, dict] | None = None) -> list[dict]:
    """Build a nested project tree from a flat list of Project ORM objects.

    O(n) single-pass: index by id, then attach children to parents.
    completion_map: optional {project_id: is_completed} to annotate each node.
    task_stats: optional {project_id: {active: n, done: n}} for progress calculation.
    Progress is aggregated: a parent's progress includes all descendant tasks.
    """
    if completion_map is None:
        completion_map = {}
    if task_stats is None:
        task_stats = {}

    lookup: dict[str, dict] = {}
    roots: list[dict] = []

    for p in all_projects:
        node = {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "status": p.status,
            "parent_id": p.parent_id,
            "start_date": p.start_date,
            "end_date": p.end_date,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "is_completed": completion_map.get(p.id, False),
            "progress": 0,
            "children": [],
        }
        lookup[p.id] = node

    for p in all_projects:
        node = lookup[p.id]
        if p.parent_id and p.parent_id in lookup:
            lookup[p.parent_id]["children"].append(node)
        else:
            roots.append(node)

    def aggregate(node: dict) -> tuple[int, int]:
        """Recursively aggregate task stats. Returns (total_active, total_done)."""
        pid = node["id"]
        active = task_stats.get(pid, {}).get("active", 0)
        done = task_stats.get(pid, {}).get("done", 0)
        for child in node["children"]:
            ca, cd = aggregate(child)
            active += ca
            done += cd
        node["progress"] = round(done / active * 100) if active > 0 else 0
        return active, done

    for root in roots:
        aggregate(root)

    return roots


def would_create_cycle(db: Session, project_id: str, new_parent_id: str) -> bool:
    """Check if setting new_parent_id as parent of project_id would create a cycle."""
    if project_id == new_parent_id:
        return True

    visited = {project_id}
    current_id = new_parent_id
    while current_id:
        if current_id in visited:
            return True
        visited.add(current_id)
        parent = db.query(Project).filter(Project.id == current_id).first()
        current_id = parent.parent_id if parent else None
    return False
