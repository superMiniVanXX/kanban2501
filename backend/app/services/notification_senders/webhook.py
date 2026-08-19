import json
import requests


def _render(template: str, event: dict) -> str:
    return (
        template
        .replace("{event}", str(event.get("event_type") or ""))
        .replace("{title}", str(event.get("task_title") or ""))
        .replace("{detail}", str(event.get("message") or ""))
    )


def send(channel, event):
    cfg = channel.config
    rendered = _render(cfg.get("body_template", ""), event)
    is_json = False
    body_json = rendered
    if rendered.strip().startswith("{"):
        try:
            body_json = json.loads(rendered)
            is_json = True
        except json.JSONDecodeError:
            pass  # body_json stays as the rendered string, is_json stays False

    resp = requests.request(
        method=cfg.get("method", "POST"),
        url=cfg["url"],
        headers=cfg.get("headers", {}),
        json=body_json if is_json else None,
        data=None if is_json else body_json,
        timeout=10,
    )
    return {"http_status": resp.status_code}
