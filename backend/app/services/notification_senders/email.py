import os
import smtplib
from email.message import EmailMessage


def send(channel, event):
    cfg = channel.config
    password_env = cfg["password_env"]
    if password_env not in os.environ:
        raise KeyError("SMTP password environment variable is not set")
    password = os.environ[password_env]

    msg = EmailMessage()
    msg["From"] = cfg["from_addr"] if "from_addr" in cfg else cfg.get("from", "")
    msg["To"] = ", ".join(cfg["to"])
    msg["Subject"] = f"[Kanban] {event['event_type']}: {event.get('task_title') or ''}"
    msg.set_content(event.get("message") or "")

    with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=10) as s:
        if cfg.get("use_tls", True):
            s.starttls()
        if cfg.get("username"):
            s.login(cfg["username"], password)
        s.send_message(msg)

    return {"smtp_host": cfg["smtp_host"], "recipients": len(cfg["to"])}
