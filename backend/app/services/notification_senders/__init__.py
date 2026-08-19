from app.services.notification_senders.desktop import send as desktop_send
from app.services.notification_senders.webhook import send as webhook_send
from app.services.notification_senders.sound import send as sound_send
from app.services.notification_senders.email import send as email_send


SENDERS = {
    "desktop": desktop_send,
    "webhook": webhook_send,
    "sound": sound_send,
    "email": email_send,
}


def get_sender(channel_type: str):
    return SENDERS.get(channel_type)
