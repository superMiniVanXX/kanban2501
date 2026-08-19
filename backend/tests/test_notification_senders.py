import os
from unittest.mock import patch, MagicMock

import pytest

from app.models.notification_channel import NotificationChannel
from app.services.notification_senders.desktop import send as send_desktop
from app.services.notification_senders.webhook import send as send_webhook
from app.services.notification_senders.sound import send as send_sound
from app.services.notification_senders.email import send as send_email


EVENT = {
    "event_type": "Stop",
    "task_id": None,
    "project_id": None,
    "task_title": "Test task",
    "message": "Agent finished",
    "agent": "claude-code",
    "payload": {},
}


def _make_channel(channel_type, config):
    return NotificationChannel(
        id="c1", name="test", channel_type=channel_type, config=config,
        event_filters=[], project_filters=[], enabled=True,
    )


def test_desktop_sender_calls_notify_send():
    ch = _make_channel("desktop", {"command": "notify-send"})
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = send_desktop(ch, EVENT)
    assert mock_run.call_count == 1
    args = mock_run.call_args[0][0]
    assert args[0] == "notify-send"
    assert "Stop" in args[1]
    assert "Test task" in args[2] or "Agent finished" in args[2]
    assert result == {"command": "notify-send"}


def test_desktop_sender_raises_on_nonzero_exit():
    ch = _make_channel("desktop", {"command": "notify-send"})
    import subprocess as sp
    with patch("app.services.notification_senders.desktop.subprocess.run") as mock_run:
        mock_run.side_effect = sp.CalledProcessError(returncode=1, cmd="notify-send")
        with pytest.raises(sp.CalledProcessError):
            send_desktop(ch, EVENT)


def test_webhook_sender_posts_rendered_body():
    ch = _make_channel("webhook", {
        "url": "https://hooks.example.com/test",
        "method": "POST",
        "headers": {"Authorization": "Bearer x"},
        "body_template": '{"event": "{event}", "title": "{title}"}',
    })
    with patch("app.services.notification_senders.webhook.requests.request") as mock_request:
        mock_resp = MagicMock(status_code=200)
        mock_request.return_value = mock_resp
        result = send_webhook(ch, EVENT)
    mock_request.assert_called_once()
    kwargs = mock_request.call_args.kwargs
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == "https://hooks.example.com/test"
    assert kwargs["headers"] == {"Authorization": "Bearer x"}
    assert kwargs["json"] == {"event": "Stop", "title": "Test task"}
    assert result == {"http_status": 200}


def test_webhook_sender_raises_on_request_error():
    ch = _make_channel("webhook", {"url": "https://x", "body_template": "{}"})
    with patch("app.services.notification_senders.webhook.requests.request") as mock_request:
        mock_request.side_effect = Exception("connection refused")
        with pytest.raises(Exception, match="connection refused"):
            send_webhook(ch, EVENT)


def test_webhook_sender_forwards_put_method():
    ch = _make_channel("webhook", {
        "url": "https://hooks.example.com/put",
        "method": "PUT",
        "body_template": "{}",
    })
    with patch("app.services.notification_senders.webhook.requests.request") as mock_req:
        mock_req.return_value = MagicMock(status_code=200)
        send_webhook(ch, EVENT)
    kwargs = mock_req.call_args.kwargs
    assert kwargs["method"] == "PUT"
    assert kwargs["url"] == "https://hooks.example.com/put"


def test_webhook_sender_non_json_body_sent_as_data():
    ch = _make_channel("webhook", {
        "url": "https://x",
        "body_template": "plain text body",  # not JSON
    })
    with patch("app.services.notification_senders.webhook.requests.request") as mock_req:
        mock_req.return_value = MagicMock(status_code=200)
        send_webhook(ch, EVENT)
    kwargs = mock_req.call_args.kwargs
    assert kwargs["json"] is None
    assert kwargs["data"] == "plain text body"


def test_sound_sender_calls_paplay():
    ch = _make_channel("sound", {"file": "/usr/share/sounds/ding.ogg", "command": "paplay"})
    with patch("app.services.notification_senders.sound.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = send_sound(ch, EVENT)
    args = mock_run.call_args[0][0]
    assert args == ["paplay", "/usr/share/sounds/ding.ogg"]
    assert result["file"] == "/usr/share/sounds/ding.ogg"


def test_email_sender_smtp_flow():
    os.environ["TEST_SMTP_PASS"] = "secret"
    try:
        ch = _make_channel("email", {
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "username": "u",
            "password_env": "TEST_SMTP_PASS",
            "from": "kanban@example.com",
            "to": ["dev@example.com"],
            "use_tls": True,
        })
        with patch("app.services.notification_senders.email.smtplib.SMTP") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_email(ch, EVENT)
        mock_smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
        instance.starttls.assert_called_once()
        instance.login.assert_called_once_with("u", "secret")
        instance.send_message.assert_called_once()
        sent_msg = instance.send_message.call_args[0][0]
        assert sent_msg["From"] == "kanban@example.com"
        assert sent_msg["To"] == "dev@example.com"
        assert "Stop" in sent_msg["Subject"]
    finally:
        del os.environ["TEST_SMTP_PASS"]


def test_email_sender_missing_password_env_raises():
    ch = _make_channel("email", {
        "smtp_host": "h", "smtp_port": 587, "username": "u",
        "password_env": "MISSING_ENV_VAR_xyz",
        "from": "a@b", "to": ["c@d"], "use_tls": False,
    })
    with patch("app.services.notification_senders.email.smtplib.SMTP"):
        with pytest.raises(KeyError):
            send_email(ch, EVENT)
