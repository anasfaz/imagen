"""Backend tests for the OAuth 2.0 discovery + DCR + Authorization Code (PKCE S256)
flow that claude.ai executes when adding the Imagen Studio custom connector."""
import base64
import hashlib
import os
import secrets
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://imagen-studio-12.preview.emergentagent.com").rstrip("/")


def _pkce_pair():
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


@pytest.fixture(scope="module")
def mcp_token():
    r = requests.get(f"{BASE_URL}/api/settings", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("mcp_token"), "settings must expose mcp_token"
    return data["mcp_token"]


# ---------------- discovery ----------------
class TestDiscovery:
    def test_authorization_server_metadata(self):
        r = requests.get(f"{BASE_URL}/api/.well-known/oauth-authorization-server", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "issuer" in d
        assert d["authorization_endpoint"].endswith("/oauth/authorize")
        assert d["token_endpoint"].endswith("/oauth/token")
        assert d["registration_endpoint"].endswith("/oauth/register")
        assert "code" in d["response_types_supported"]
        assert "authorization_code" in d["grant_types_supported"]
        assert "refresh_token" in d["grant_types_supported"]
        assert "S256" in d["code_challenge_methods_supported"]

    def test_protected_resource_metadata(self):
        r = requests.get(f"{BASE_URL}/api/.well-known/oauth-protected-resource", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "resource" in d
        assert isinstance(d["authorization_servers"], list) and len(d["authorization_servers"]) >= 1
        # authorization_servers must contain the issuer
        meta = requests.get(f"{BASE_URL}/api/.well-known/oauth-authorization-server", timeout=30).json()
        assert meta["issuer"] in d["authorization_servers"]
        assert "header" in d["bearer_methods_supported"]


class TestMcpUnauthorized:
    def test_mcp_401_with_www_authenticate(self):
        r = requests.post(f"{BASE_URL}/api/mcp/", json={}, timeout=30, allow_redirects=False)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:300]}"
        www = r.headers.get("WWW-Authenticate") or r.headers.get("www-authenticate")
        assert www and www.startswith("Bearer "), f"missing Bearer challenge, got {www!r}"
        assert "resource_metadata=" in www
        assert "/api/.well-known/oauth-protected-resource" in www

    def test_options_passes_through(self):
        # CORS pre-flight should not 401
        r = requests.options(
            f"{BASE_URL}/api/mcp/",
            headers={
                "Origin": "https://claude.ai",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
            timeout=30,
        )
        assert r.status_code != 401, f"OPTIONS should pass through, got {r.status_code}"


# ---------------- DCR ----------------
class TestRegistration:
    def test_register_returns_credentials(self):
        r = requests.post(
            f"{BASE_URL}/api/oauth/register",
            json={"redirect_uris": ["https://claude.ai/api/mcp/callback"], "client_name": "Claude Test"},
            timeout=30,
        )
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["client_id"]
        assert d["client_secret"]
        assert "authorization_code" in d["grant_types"]
        assert d["redirect_uris"] == ["https://claude.ai/api/mcp/callback"]


# ---------------- Full OAuth flow ----------------
def _register_client(redirect_uri="https://claude.ai/api/mcp/callback"):
    r = requests.post(
        f"{BASE_URL}/api/oauth/register",
        json={"redirect_uris": [redirect_uri], "client_name": "test"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    return r.json()["client_id"]


def _get_code(client_id, redirect_uri, challenge, state="xyz"):
    r = requests.get(
        f"{BASE_URL}/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "scope": "mcp",
        },
        timeout=30,
        allow_redirects=False,
    )
    assert r.status_code == 302, f"expected 302 got {r.status_code}: {r.text[:300]}"
    loc = r.headers["Location"]
    assert loc.startswith(redirect_uri + "?"), f"unexpected Location: {loc}"
    # parse code + state
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(loc).query)
    assert q.get("state") == [state]
    return q["code"][0]


class TestAuthorizeAndToken:
    def test_authorize_returns_302_with_code(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        _, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge, state="abc123")
        assert code and len(code) > 10

    def test_authorize_unsupported_response_type(self):
        client_id = _register_client()
        r = requests.get(
            f"{BASE_URL}/api/oauth/authorize",
            params={
                "response_type": "id_token",
                "client_id": client_id,
                "redirect_uri": "https://claude.ai/api/mcp/callback",
                "state": "s",
            },
            timeout=30,
            allow_redirects=False,
        )
        assert r.status_code == 400, r.text

    def test_token_exchange_success_returns_mcp_token(self, mcp_token):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge)
        r = requests.post(
            f"{BASE_URL}/api/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "code_verifier": verifier,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["access_token"] == mcp_token
        assert d["token_type"] == "Bearer"
        assert d["expires_in"] > 0
        assert d["refresh_token"]
        assert d["scope"] == "mcp"

    def test_token_exchange_wrong_pkce_verifier(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        _, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge)
        r = requests.post(
            f"{BASE_URL}/api/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "code_verifier": "wrong-verifier-value",
            },
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "invalid_grant" in r.text

    def test_code_is_single_use(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge)
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": verifier,
        }
        r1 = requests.post(f"{BASE_URL}/api/oauth/token", data=payload, timeout=30)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{BASE_URL}/api/oauth/token", data=payload, timeout=30)
        assert r2.status_code == 400, r2.text
        assert "invalid_grant" in r2.text

    def test_refresh_token_grant(self, mcp_token):
        r = requests.post(
            f"{BASE_URL}/api/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": mcp_token},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["access_token"] == mcp_token
        assert d["token_type"] == "Bearer"


# ---------------- MCP handshake with obtained token ----------------
def _mcp_initialize(token):
    """Do MCP initialize → notifications/initialized → tools/list handshake."""
    session = requests.Session()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    init_payload = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1.0"},
        },
    }
    r = session.post(f"{BASE_URL}/api/mcp/", json=init_payload, headers=headers, timeout=60)
    assert r.status_code == 200, f"initialize failed {r.status_code}: {r.text[:400]}"
    session_id = r.headers.get("mcp-session-id") or r.headers.get("Mcp-Session-Id")
    if session_id:
        headers["mcp-session-id"] = session_id
    # notifications/initialized
    session.post(
        f"{BASE_URL}/api/mcp/",
        json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        headers=headers, timeout=30,
    )
    # tools/list
    r2 = session.post(
        f"{BASE_URL}/api/mcp/",
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        headers=headers, timeout=60,
    )
    assert r2.status_code == 200, f"tools/list failed {r2.status_code}: {r2.text[:400]}"
    # Response could be SSE-framed
    body = r2.text
    if "data:" in body:
        # extract the JSON payload after "data:"
        import json as _json
        for line in body.splitlines():
            if line.startswith("data:"):
                payload = _json.loads(line[5:].strip())
                return payload
    return r2.json()


class TestMcpWithToken:
    def test_full_handshake_and_tools_list(self, mcp_token):
        # First run full OAuth flow to obtain access_token, ensure it equals mcp_token
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge)
        tok_r = requests.post(
            f"{BASE_URL}/api/oauth/token",
            data={
                "grant_type": "authorization_code", "code": code,
                "redirect_uri": redirect_uri, "client_id": client_id,
                "code_verifier": verifier,
            }, timeout=30,
        )
        assert tok_r.status_code == 200
        access_token = tok_r.json()["access_token"]
        assert access_token == mcp_token
        payload = _mcp_initialize(access_token)
        tools = payload.get("result", {}).get("tools", [])
        names = sorted(t["name"] for t in tools)
        expected = sorted([
            "generate_image", "bulk_generate", "get_batch_status",
            "list_style_presets", "create_style_preset", "list_gallery",
        ])
        assert names == expected, f"got {names}"

    def test_plain_bearer_still_works(self, mcp_token):
        # Just POST an initialize using the plain mcp_token
        payload = _mcp_initialize(mcp_token)
        assert "result" in payload or "error" not in payload

    def test_path_token_still_works(self, mcp_token):
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        r = requests.post(
            f"{BASE_URL}/api/mcp/{mcp_token}/",
            json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                           "clientInfo": {"name": "pytest", "version": "1.0"}},
            },
            headers=headers, timeout=60,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text[:300]}"


# ---------------- non-MCP regression ----------------
class TestNonMcpEndpoints:
    def test_models(self):
        r = requests.get(f"{BASE_URL}/api/models", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d["models"]) == 2

    def test_gallery(self):
        r = requests.get(f"{BASE_URL}/api/gallery", timeout=30)
        assert r.status_code == 200
        assert "generations" in r.json()

    def test_collections(self):
        r = requests.get(f"{BASE_URL}/api/collections", timeout=30)
        assert r.status_code == 200
        assert "collections" in r.json()

    def test_style_presets(self):
        r = requests.get(f"{BASE_URL}/api/style-presets", timeout=30)
        assert r.status_code == 200
        assert "presets" in r.json()

    def test_settings_has_mcp_connect_path(self):
        r = requests.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["mcp_connect_path"].startswith("/api/mcp/")
        assert d["mcp_connect_path"].endswith("/")


# ---------------- regenerate MCP token invalidates old ----------------
class TestRegenerateInvalidatesOld:
    def test_regenerate_and_reflow(self):
        # capture old
        old = requests.get(f"{BASE_URL}/api/settings", timeout=30).json()["mcp_token"]
        # regenerate
        r = requests.post(f"{BASE_URL}/api/settings/mcp/regenerate", timeout=30)
        assert r.status_code == 200, r.text
        new = r.json()["mcp_token"]
        assert new and new != old

        # OAuth flow → yields new
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _register_client(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _get_code(client_id, redirect_uri, challenge)
        tok = requests.post(
            f"{BASE_URL}/api/oauth/token",
            data={"grant_type": "authorization_code", "code": code,
                  "redirect_uri": redirect_uri, "client_id": client_id,
                  "code_verifier": verifier},
            timeout=30,
        )
        assert tok.status_code == 200
        assert tok.json()["access_token"] == new

        # Old token now rejected on /api/mcp/
        r_old = requests.post(
            f"{BASE_URL}/api/mcp/",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                             "clientInfo": {"name": "x", "version": "1"}}},
            headers={"Authorization": f"Bearer {old}",
                     "Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"},
            timeout=30,
        )
        assert r_old.status_code == 401, f"expected 401 for old token got {r_old.status_code}"
