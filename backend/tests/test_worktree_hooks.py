import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.worktree_hooks import (
    HOOK_EVENTS,
    FORWARDER_PATH,
    ensure_forwarder_script,
    write_hooks_to_worktree,
    remove_hooks_from_worktree,
)


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """Redirect $HOME so tests don't touch the real ~/.config/kanban/."""
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def worktree_dir(tmp_path):
    d = tmp_path / "wt"
    d.mkdir()
    return d


def test_ensure_forwarder_creates_script(fake_home):
    target = Path(FORWARDER_PATH).expanduser()
    assert not target.exists()
    ensure_forwarder_script()
    assert target.exists()
    assert target.stat().st_mode & 0o111  # executable bit set
    content = target.read_text()
    assert "agent-events" in content
    assert "exit 0" in content


def test_ensure_forwarder_idempotent(fake_home):
    ensure_forwarder_script()
    target = Path(FORWARDER_PATH).expanduser()
    first_mtime = target.stat().st_mtime
    ensure_forwarder_script()
    # File still exists; mtime may or may not be unchanged but content is identical.
    assert target.exists()


def test_write_hooks_creates_settings_when_missing(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    assert settings.exists()
    data = json.loads(settings.read_text())
    for event in HOOK_EVENTS:
        assert event in data["hooks"]
        entries = data["hooks"][event]
        assert len(entries) == 1
        cmd = entries[0]["hooks"][0]["command"]
        assert cmd.endswith("claude-code-forwarder.sh")


def test_write_hooks_merges_into_existing_without_loss(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "permissions": {"allow": ["Bash(ls:*)"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "/user/own/script.sh"}]}],
        },
    }))
    write_hooks_to_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    # User's permission block preserved
    assert data["permissions"]["allow"] == ["Bash(ls:*)"]
    # User's Stop hook preserved AND ours appended
    stop_entries = data["hooks"]["Stop"]
    commands = [e["hooks"][0]["command"] for e in stop_entries]
    assert "/user/own/script.sh" in commands
    assert any(c.endswith("claude-code-forwarder.sh") for c in commands)
    # Other events also added
    assert "Notification" in data["hooks"]


def test_write_hooks_idempotent_on_rerun(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    data = json.loads(settings.read_text())
    for event in HOOK_EVENTS:
        entries = data["hooks"][event]
        # Should be exactly ONE entry pointing at our forwarder.
        forwarder_entries = [
            e for e in entries
            if e["hooks"][0]["command"].endswith("claude-code-forwarder.sh")
        ]
        assert len(forwarder_entries) == 1


def test_remove_hooks_drops_only_kanban_entries(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "hooks": {
            "Stop": [
                {"hooks": [{"type": "command", "command": "/user/own/script.sh"}]},
                {"hooks": [{"type": "command", "command": "/home/u/.config/kanban/hooks/claude-code-forwarder.sh"}]},
            ],
        },
    }))
    remove_hooks_from_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    stop_entries = data["hooks"]["Stop"]
    commands = [e["hooks"][0]["command"] for e in stop_entries]
    assert commands == ["/user/own/script.sh"]


def test_remove_hooks_deletes_empty_settings_file(worktree_dir):
    write_hooks_to_worktree(worktree_dir)
    settings = worktree_dir / ".claude" / "settings.json"
    assert settings.exists()
    remove_hooks_from_worktree(worktree_dir)
    assert not settings.exists()


def test_remove_hooks_preserves_file_with_user_entries(worktree_dir):
    settings = worktree_dir / ".claude" / "settings.json"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({
        "permissions": {"allow": ["Bash(ls:*)"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "/home/u/.config/kanban/hooks/claude-code-forwarder.sh"}]}],
            "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "/user/other.sh"}]}],
        },
    }))
    remove_hooks_from_worktree(worktree_dir)
    data = json.loads(settings.read_text())
    # Our Stop entry gone; UserPromptSubmit untouched; permissions preserved.
    assert "Stop" not in data["hooks"]
    assert "UserPromptSubmit" in data["hooks"]
    assert data["permissions"]["allow"] == ["Bash(ls:*)"]


def test_remove_hooks_on_missing_file_is_noop(worktree_dir):
    # No settings.json exists at all; should not raise.
    remove_hooks_from_worktree(worktree_dir)
