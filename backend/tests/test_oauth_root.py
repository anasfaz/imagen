"""Backend tests for ROOT-LEVEL OAuth discovery and endpoints (no /api prefix),
which is what claude.ai actually probes when registering a custom connector.
These paths are served by the FastAPI backend via a frontend dev-server proxy
(setupProxy.js) that rewrites /.well-known/oauth-* and /oauth/* to /api/....
"""
import base64
import hashlib
import os
import secrets
from urllib.parse import parse_qs, urlparse

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://imagen-studio-12.preview.emergentagent.com",
).rstrip("/")


def _pkce_pair():
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


@pytest.fixture(scope="module")
def mcp_token():
    r = requests.get(f"{BASE_URL}/api/settings", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["mcp_token"]


# ---------------- ROOT-LEVEL discovery ----------------
class TestRootDiscovery:
    def test_root_authorization_server_metadata(self):
        r = requests.get(f"{BASE_URL}/.well-known/oauth-authorization-server", timeout=30)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type", "").startswith("application/json"), (
            f"expected JSON, got {r.headers.get('Content-Type')!r} body={r.text[:200]}"
        )
        d = r.json()
        assert d["issuer"]
        assert d["authorization_endpoint"].endswith("/oauth/authorize")
        assert d["token_endpoint"].endswith("/oauth/token")
        assert d["registration_endpoint"].endswith("/oauth/register")
        assert "code" in d["response_types_supported"]
        assert "authorization_code" in d["grant_types_supported"]
        assert "S256" in d["code_challenge_methods_supported"]

    def test_root_authorization_server_metadata_with_api_suffix(self):
        # RFC 8414 issuer-path variant: /.well-known/oauth-authorization-server/<issuer-path>
        r = requests.get(f"{BASE_URL}/.well-known/oauth-authorization-server/api", timeout=30)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type", "").startswith("application/json")
        d = r.json()
        # Should be identical metadata payload
        assert d["issuer"].endswith("/api")
        assert d["token_endpoint"].endswith("/oauth/token")

    def test_root_protected_resource_metadata(self):
        r = requests.get(f"{BASE_URL}/.well-known/oauth-protected-resource", timeout=30)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type", "").startswith("application/json")
        d = r.json()
        assert d["resource"]
        assert isinstance(d["authorization_servers"], list) and d["authorization_servers"]
        assert "header" in d["bearer_methods_supported"]


class TestRootWwwAuthenticateOnMcp:
    def test_mcp_401_points_at_root_resource_metadata(self):
        r = requests.post(f"{BASE_URL}/api/mcp/", json={}, timeout=30, allow_redirects=False)
        assert r.status_code == 401
        www = r.headers.get("WWW-Authenticate") or r.headers.get("www-authenticate")
        assert www and www.lower().startswith("bearer "), www
        # KEY: root-level resource-metadata URL (no /api prefix in the path)
        assert f'resource_metadata="{BASE_URL}/.well-known/oauth-protected-resource"' in www, www


# ---------------- ROOT-LEVEL DCR ----------------
class TestRootRegistration:
    def test_root_register_returns_credentials(self):
        r = requests.post(
            f"{BASE_URL}/oauth/register",
            json={
                "client_name": "Claude",
                "redirect_uris": ["https://claude.ai/api/mcp/callback"],
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
            },
            timeout=30,
        )
        assert r.status_code == 201, r.text[:400]
        assert r.headers.get("Content-Type", "").startswith("application/json")
        d = r.json()
        assert d["client_id"]
        assert d["client_secret"]
        assert d["redirect_uris"] == ["https://claude.ai/api/mcp/callback"]

    def test_options_preflight_no_401(self):
        r = requests.options(
            f"{BASE_URL}/oauth/register",
            headers={
                "Origin": "https://claude.ai",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=30,
        )
        assert r.status_code in (200, 204), f"got {r.status_code}: {r.text[:200]}"


# ---------------- ROOT-LEVEL Authorize + Token flow ----------------
def _root_register(redirect_uri="https://claude.ai/api/mcp/callback"):
    r = requests.post(
        f"{BASE_URL}/oauth/register",
        json={"redirect_uris": [redirect_uri], "client_name": "test-root"},
        timeout=30,
    )
    assert r.status_code == 201
    return r.json()["client_id"]


def _root_authorize(client_id, redirect_uri, challenge, state="root-state"):
    r = requests.get(
        f"{BASE_URL}/oauth/authorize",
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
    assert r.status_code == 302, f"expected 302 got {r.status_code}: {r.text[:200]}"
    loc = r.headers["Location"]
    assert loc.startswith(redirect_uri), loc
    q = parse_qs(urlparse(loc).query)
    assert q.get("state") == [state]
    assert q.get("code")
    return q["code"][0]


class TestRootFullFlow:
    def test_root_authorize_returns_302_with_code(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _root_register(redirect_uri)
        _, challenge = _pkce_pair()
        code = _root_authorize(client_id, redirect_uri, challenge)
        assert code and len(code) > 10

    def test_root_token_exchange_returns_mcp_token(self, mcp_token):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _root_register(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _root_authorize(client_id, redirect_uri, challenge)
        r = requests.post(
            f"{BASE_URL}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "code_verifier": verifier,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type", "").startswith("application/json")
        d = r.json()
        assert d["access_token"] == mcp_token
        assert d["token_type"] == "Bearer"
        assert d["expires_in"] > 0
        assert d["scope"] == "mcp"

    def test_root_pkce_wrong_verifier(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _root_register(redirect_uri)
        _, challenge = _pkce_pair()
        code = _root_authorize(client_id, redirect_uri, challenge)
        r = requests.post(
            f"{BASE_URL}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "code_verifier": "wrong-verifier",
            },
            timeout=30,
        )
        assert r.status_code == 400
        assert "invalid_grant" in r.text

    def test_root_code_single_use(self):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _root_register(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _root_authorize(client_id, redirect_uri, challenge)
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": verifier,
        }
        r1 = requests.post(f"{BASE_URL}/oauth/token", data=payload, timeout=30)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/oauth/token", data=payload, timeout=30)
        assert r2.status_code == 400

    def test_root_refresh_token_grant(self, mcp_token):
        r = requests.post(
            f"{BASE_URL}/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": mcp_token},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["access_token"] == mcp_token
        assert d["token_type"] == "Bearer"


# ---------------- Post-flow MCP handshake using root-obtained token ----------------
class TestRootObtainedTokenOnMcp:
    def test_root_flow_token_completes_mcp_handshake(self, mcp_token):
        redirect_uri = "https://claude.ai/api/mcp/callback"
        client_id = _root_register(redirect_uri)
        verifier, challenge = _pkce_pair()
        code = _root_authorize(client_id, redirect_uri, challenge)
        tok = requests.post(
            f"{BASE_URL}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "code_verifier": verifier,
            },
            timeout=30,
        ).json()["access_token"]
        assert tok == mcp_token

        session = requests.Session()
        headers = {
            "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        init = session.post(
            f"{BASE_URL}/api/mcp/",
            json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                           "clientInfo": {"name": "pytest-root", "version": "1"}},
            },
            headers=headers, timeout=60,
        )
        assert init.status_code == 200, init.text[:400]
        sid = init.headers.get("mcp-session-id") or init.headers.get("Mcp-Session-Id")
        if sid:
            headers["mcp-session-id"] = sid
        session.post(
            f"{BASE_URL}/api/mcp/",
            json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            headers=headers, timeout=30,
        )
        r2 = session.post(
            f"{BASE_URL}/api/mcp/",
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            headers=headers, timeout=60,
        )
        assert r2.status_code == 200
        body = r2.text
        if "data:" in body:
            import json as _json
            payload = None
            for line in body.splitlines():
                if line.startswith("data:"):
                    payload = _json.loads(line[5:].strip())
                    break
        else:
            payload = r2.json()
        tools = payload["result"]["tools"]
        assert len(tools) == 6, [t["name"] for t in tools]


# ---------------- Existing modes still work ----------------
class TestExistingAuthStillWorks:
    def test_bearer_header_on_api_mcp(self, mcp_token):
        r = requests.post(
            f"{BASE_URL}/api/mcp/",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                             "clientInfo": {"name": "x", "version": "1"}}},
            headers={"Authorization": f"Bearer {mcp_token}",
                     "Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"},
            timeout=30,
        )
        assert r.status_code == 200

    def test_path_token_on_api_mcp(self, mcp_token):
        r = requests.post(
            f"{BASE_URL}/api/mcp/{mcp_token}/",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                             "clientInfo": {"name": "x", "version": "1"}}},
            headers={"Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"},
            timeout=30,
        )
        assert r.status_code == 200


# ---------------- Non-MCP regression ----------------
class TestNonMcpRegression:
    def test_models(self):
        r = requests.get(f"{BASE_URL}/api/models", timeout=30)
        assert r.status_code == 200 and len(r.json()["models"]) == 2

    def test_settings(self):
        r = requests.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["mcp_connect_path"].startswith("/api/mcp/") and d["mcp_connect_path"].endswith("/")

    def test_gallery(self):
        r = requests.get(f"{BASE_URL}/api/gallery", timeout=30)
        assert r.status_code == 200 and "generations" in r.json()

    def test_collections(self):
        r = requests.get(f"{BASE_URL}/api/collections", timeout=30)
        assert r.status_code == 200 and "collections" in r.json()

    def test_style_presets(self):
        r = requests.get(f"{BASE_URL}/api/style-presets", timeout=30)
        assert r.status_code == 200 and "presets" in r.json()
