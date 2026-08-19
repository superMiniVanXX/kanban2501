import subprocess


def send(channel, event):
    cmd = channel.config.get("command", "notify-send")
    args = channel.config.get("args", ["--urgency=critical", "--expire-time=0"])
    title = f"Kanban: {event['event_type']}"
    body = event.get("message") or event.get("task_title") or ""
    subprocess.run([cmd, *args, title, body], timeout=5, check=True)
    return {"command": cmd}
