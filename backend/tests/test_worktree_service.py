from app.services.worktree_service import expand_template


class MockTask:
    def __init__(self):
        self.id = "abc12345-6789-def0-1234-567890abcdef"
        self.title = "Add worktree support"
        self.task_type = "task"
        self.priority = "high"
        self.assignee = "alice"


class MockProject:
    def __init__(self):
        self.id = "proj-001"
        self.name = "Kanban-PMP"


def test_expand_template_branch():
    task = MockTask()
    project = MockProject()
    result = expand_template("feature/{task_id_short}-{task_title_slug}", task, project)
    assert result == "feature/abc12345-add-worktree-support"


def test_expand_template_dir_with_branch():
    task = MockTask()
    project = MockProject()
    result = expand_template("/tmp/worktrees/{project_name}/{branch_name}", task, project, branch="feature/test")
    assert result == "/tmp/worktrees/Kanban-PMP/feature/test"


def test_expand_template_all_vars():
    task = MockTask()
    project = MockProject()
    template = "{task_id}/{task_title}/{task_type}/{task_priority}/{task_assignee}/{project_name}"
    result = expand_template(template, task, project)
    assert "abc12345-6789-def0-1234-567890abcdef" in result
    assert "Add worktree support" in result
    assert "task" in result
    assert "high" in result
    assert "alice" in result
    assert "Kanban-PMP" in result


def test_expand_template_special_chars_in_title():
    task = MockTask()
    task.title = "Fix: XSS & SQL injection!!!"
    project = MockProject()
    result = expand_template("{task_title_slug}", task, project)
    assert result == "fix-xss-sql-injection"


def test_expand_template_supports_project_slug():
    """New {project_slug} variable should be derived from project name."""
    class FakeProject:
        id = "p1"
        name = "My Cool Project!"

    class FakeTask:
        id = "task-uuid-1234"
        title = "Fix Login Bug"
        task_type = "task"
        priority = "high"
        assignee = "alice"

    result = expand_template("/srv/{project_slug}/deploy", FakeTask(), FakeProject())
    assert result == "/srv/my-cool-project/deploy"


def test_expand_template_accepts_extra_vars():
    """extra_vars should add new tokens without breaking existing ones."""
    class FakeProject:
        id = "p1"
        name = "Demo"

    class FakeTask:
        id = "t1"
        title = "Hello"
        task_type = "task"
        priority = "medium"
        assignee = None

    result = expand_template(
        "/home/{ssh_user}/{project_name}/{task_title_slug}",
        FakeTask(),
        FakeProject(),
        extra_vars={"{ssh_user}": "ubuntu"},
    )
    assert result == "/home/ubuntu/Demo/hello"


def test_expand_template_extra_vars_overrides_existing():
    """If extra_vars contains an existing token key, extra_vars wins."""
    class FakeProject:
        id = "p1"
        name = "Demo"

    class FakeTask:
        id = "t1"
        title = "Real Title"
        task_type = "task"
        priority = "medium"
        assignee = None

    result = expand_template(
        "{task_title}",
        FakeTask(),
        FakeProject(),
        extra_vars={"{task_title}": "Override"},
    )
    assert result == "Override"
