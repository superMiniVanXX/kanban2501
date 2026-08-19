from pathlib import Path

import pytest

from app.services.opencode_hooks import (
    EVENT_MAP,
    OPENCODE_PLUGIN_FILENAME,
    PLUGIN_MARKER,
    write_plugin_to_worktree,
    remove_plugin_from_worktree,
)


@pytest.fixture
def worktree_dir(tmp_path):
    d = tmp_path / "wt"
    d.mkdir()
    return d


def _plugin(worktree_dir: Path) -> Path:
    return worktree_dir / ".opencode" / "plugins" / OPENCODE_PLUGIN_FILENAME


def test_write_creates_plugin_when_missing(worktree_dir):
    result = write_plugin_to_worktree(worktree_dir)
    plugin = _plugin(worktree_dir)
    assert plugin.exists()
    assert result["installed"] is True
    content = plugin.read_text()
    assert PLUGIN_MARKER in content
    assert "agent-events" in content
    assert "KanbanForwarderPlugin" in content


def test_write_includes_all_mapped_events(worktree_dir):
    write_plugin_to_worktree(worktree_dir)
    content = _plugin(worktree_dir).read_text()
    for opencode_event in EVENT_MAP:
        assert opencode_event in content


def test_generated_plugin_is_valid_js(worktree_dir):
    """Regression guard: the template uses str.replace (not .format), so the
    rendered file must contain single braces only — no '{{' leftovers — and a
    well-formed EVENT_MAP object literal. Catches the double-brace escaping bug.
    """
    write_plugin_to_worktree(worktree_dir)
    content = _plugin(worktree_dir).read_text()
    assert "{{" not in content
    assert "}}" not in content
    # EVENT_MAP must be an object literal, not a bare first entry.
    assert "const EVENT_MAP = {\n" in content
    # destructuring params must use single braces
    assert "async ({ directory }) =>" in content
    assert "async ({ event }) =>" in content


def test_write_is_idempotent(worktree_dir):
    write_plugin_to_worktree(worktree_dir)
    result = write_plugin_to_worktree(worktree_dir)
    assert result["installed"] is False
    assert result["updated"] is False


def test_write_updates_when_host_changes(worktree_dir):
    write_plugin_to_worktree(worktree_dir, kanban_host="localhost:9527")
    result = write_plugin_to_worktree(worktree_dir, kanban_host="10.0.0.5:9000")
    assert result["updated"] is True
    content = _plugin(worktree_dir).read_text()
    assert "10.0.0.5:9000" in content
    assert "localhost:9527" not in content


def test_write_does_not_clobber_foreign_same_name_file(worktree_dir):
    plugin = _plugin(worktree_dir)
    plugin.parent.mkdir(parents=True, exist_ok=True)
    plugin.write_text("// my own plugin, not kanban's\nexport const X = 1\n")
    result = write_plugin_to_worktree(worktree_dir)
    assert result["installed"] is False
    assert result["skipped"] == "foreign_file"
    assert "X = 1" in plugin.read_text()


def test_remove_drops_our_plugin(worktree_dir):
    write_plugin_to_worktree(worktree_dir)
    result = remove_plugin_from_worktree(worktree_dir)
    assert result["removed"] is True
    assert not _plugin(worktree_dir).exists()


def test_remove_cleans_empty_dirs(worktree_dir):
    write_plugin_to_worktree(worktree_dir)
    remove_plugin_from_worktree(worktree_dir)
    # Both .opencode/plugins and .opencode were created by us and are now empty.
    assert not (worktree_dir / ".opencode" / "plugins").exists()
    assert not (worktree_dir / ".opencode").exists()


def test_remove_keeps_dir_with_other_plugins(worktree_dir):
    write_plugin_to_worktree(worktree_dir)
    other = _plugin(worktree_dir).with_name("user-plugin.js")
    other.write_text("// user plugin\n")
    remove_plugin_from_worktree(worktree_dir)
    assert other.exists()
    assert not _plugin(worktree_dir).exists()


def test_remove_skips_foreign_same_name_file(worktree_dir):
    plugin = _plugin(worktree_dir)
    plugin.parent.mkdir(parents=True, exist_ok=True)
    plugin.write_text("// user-owned\n")
    result = remove_plugin_from_worktree(worktree_dir)
    assert result["removed"] is False
    assert result["skipped"] == "foreign_file"
    assert plugin.exists()


def test_remove_on_missing_is_noop(worktree_dir):
    result = remove_plugin_from_worktree(worktree_dir)
    assert result["removed"] is False
    assert result["existed"] is False
