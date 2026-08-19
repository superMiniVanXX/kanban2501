import subprocess


def send(channel, event):
    cmd = channel.config.get("command", "paplay")
    file_path = channel.config["file"]
    subprocess.run([cmd, file_path], timeout=5, check=True)
    return {"command": cmd, "file": file_path}
