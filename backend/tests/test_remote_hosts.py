import pytest


@pytest.fixture
def sample_host(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "dev-server",
        "ssh_user": "ubuntu",
        "ssh_host": "10.0.0.5",
        "ssh_port": 22,
        "base_path_template": "/home/{ssh_user}/deploy/{task_title_slug}",
        "description": "Dev environment",
    })
    assert resp.status_code == 201
    return resp.json()


def test_create_remote_host(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "prod",
        "ssh_user": "deploy",
        "ssh_host": "prod.example.com",
        "base_path_template": "/srv/app/{task_title_slug}",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "prod"
    assert data["ssh_port"] == 22  # default applied
    assert "id" in data and len(data["id"]) == 36


def test_create_remote_host_validation_error(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "missing-fields",
    })
    assert resp.status_code == 422


def test_create_remote_host_invalid_port(client):
    resp = client.post("/api/v1/remote-hosts", json={
        "name": "bad-port",
        "ssh_user": "u",
        "ssh_host": "h",
        "ssh_port": 99999,
        "base_path_template": "/x",
    })
    assert resp.status_code == 422


def test_list_remote_hosts(client, sample_host):
    resp = client.get("/api/v1/remote-hosts")
    assert resp.status_code == 200
    assert any(h["id"] == sample_host["id"] for h in resp.json())


def test_get_remote_host(client, sample_host):
    resp = client.get(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "dev-server"


def test_get_remote_host_404(client):
    resp = client.get("/api/v1/remote-hosts/nonexistent")
    assert resp.status_code == 404


def test_update_remote_host(client, sample_host):
    resp = client.put(f"/api/v1/remote-hosts/{sample_host['id']}", json={
        "name": "staging-server",
        "ssh_port": 2222,
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "staging-server"
    assert resp.json()["ssh_port"] == 2222


def test_update_remote_host_404(client):
    resp = client.put("/api/v1/remote-hosts/nonexistent", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_remote_host(client, sample_host):
    resp = client.delete(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 204
    # Verify it's gone
    resp = client.get(f"/api/v1/remote-hosts/{sample_host['id']}")
    assert resp.status_code == 404


def test_delete_remote_host_404(client):
    resp = client.delete("/api/v1/remote-hosts/nonexistent")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Security: ssh_user / ssh_host pattern validation (Finding 1 & 2)
# ---------------------------------------------------------------------------

VALID_BASE = {
    "name": "sec-test",
    "base_path_template": "/srv/app/{task_title_slug}",
}


@pytest.mark.parametrize("ssh_user", [
    "ubuntu",
    "deploy",
    "deploy.svc",      # service account with dot
    "ci_user",         # underscore
    "a-b",             # hyphen
    "root",
])
def test_create_remote_host_accepts_valid_ssh_user(client, ssh_user):
    resp = client.post("/api/v1/remote-hosts", json={
        **VALID_BASE, "ssh_user": ssh_user, "ssh_host": "10.0.0.5",
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ssh_user"] == ssh_user


@pytest.mark.parametrize("ssh_user", [
    "root; rm -rf /",          # shell metacharacters + spaces
    "-oProxyCommand=evil",     # leading hyphen (ssh option injection)
    "a b",                     # space
    "user@host",               # @ (wrong field)
    "user/name",               # slash
    "",                        # empty
    "user$VAR",                # shell variable
    "user`id`",                # backtick command substitution
    "user|cat",                # pipe
    "a" * 101,                 # exceeds max_length=100
])
def test_create_remote_host_rejects_malicious_ssh_user(client, ssh_user):
    resp = client.post("/api/v1/remote-hosts", json={
        **VALID_BASE, "ssh_user": ssh_user, "ssh_host": "10.0.0.5",
    })
    assert resp.status_code == 422, f"expected 422 for ssh_user={ssh_user!r}, got {resp.status_code}"


@pytest.mark.parametrize("ssh_host", [
    "10.0.0.5",                    # IPv4
    "prod-server.example.com",     # RFC-1123 hostname
    "::1",                         # IPv6 loopback
    "fe80::1ff:fe23:4567:890a",    # IPv6
    "my-host",                     # single label
    "server-01.dc1.example.com",   # FQDN
])
def test_create_remote_host_accepts_valid_ssh_host(client, ssh_host):
    resp = client.post("/api/v1/remote-hosts", json={
        **VALID_BASE, "ssh_user": "ubuntu", "ssh_host": ssh_host,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ssh_host"] == ssh_host


@pytest.mark.parametrize("ssh_host", [
    "-oProxyCommand=evil",     # leading hyphen = ssh option injection
    "host; rm -rf /",          # shell metacharacters
    "host name",               # space
    "host/path",               # slash
    "user@host",               # @ (wrong field)
    "host$(id)",               # command substitution
    "host`whoami`",            # backtick
    "host|nc",                 # pipe
    "",                        # empty
    "a" * 256,                 # exceeds max_length=255
])
def test_create_remote_host_rejects_malicious_ssh_host(client, ssh_host):
    resp = client.post("/api/v1/remote-hosts", json={
        **VALID_BASE, "ssh_user": "ubuntu", "ssh_host": ssh_host,
    })
    assert resp.status_code == 422, f"expected 422 for ssh_host={ssh_host!r}, got {resp.status_code}"


def test_update_remote_host_rejects_malicious_ssh_user(client, sample_host):
    """RemoteHostUpdate must apply the same pattern validation to Optional fields."""
    resp = client.put(f"/api/v1/remote-hosts/{sample_host['id']}", json={
        "ssh_user": "-oProxyCommand=evil",
    })
    assert resp.status_code == 422


def test_update_remote_host_rejects_malicious_ssh_host(client, sample_host):
    resp = client.put(f"/api/v1/remote-hosts/{sample_host['id']}", json={
        "ssh_host": "host; rm -rf /",
    })
    assert resp.status_code == 422
