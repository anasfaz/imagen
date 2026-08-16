"""Tests for MCP URL-path token auth mode (for claude.ai custom connector)."""
import os
import json
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://imagen-studio-12.preview.emergentagent.com").rstrip("/")


def _parse_mcp_payload(resp):
    ct = resp.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                try:
                    return json.loads(line[5:].strip())
                except Exception:
                    pass
        return None
    try:
        return resp.json()
    except Exception:
        return None


@pytest.fixture(scope="module")
def settings():
    r = requests.get(f"{BASE_URL}/api/settings", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def mcp_token(settings):
    return settings["mcp_token"]


INIT_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0.1"},
    },
}

ACCEPT = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


class TestSettingsMcpConnectPath:
    def test_mcp_connect_path_present(self, settings):
        assert "mcp_connect_path" in settings
        p = settings["mcp_connect_path"]
        assert p.startswith("/api/mcp/")
        assert p.endswith("/")
        assert settings["mcp_token"] in p


class TestPathTokenAuth:
    def test_path_token_returns_200(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/{mcp_token}/"
        r = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=30)
        assert r.status_code == 200, f"body={r.text[:400]}"
        ct = r.headers.get("content-type", "")
        assert "text/event-stream" in ct or "application/json" in ct
        payload = _parse_mcp_payload(r)
        assert payload is not None
        assert payload.get("jsonrpc") == "2.0"
        assert "protocolVersion" in json.dumps(payload)

    def test_wrong_path_token_401(self):
        url = f"{BASE_URL}/api/mcp/mcp_definitelywrongtoken12345/"
        r = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=15)
        assert r.status_code == 401

    def test_no_token_anywhere_401(self):
        url = f"{BASE_URL}/api/mcp/"
        r = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=15)
        assert r.status_code == 401

    def test_bearer_header_still_works(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/"
        headers = {**ACCEPT, "Authorization": f"Bearer {mcp_token}"}
        r = requests.post(url, headers=headers, json=INIT_BODY, timeout=30)
        assert r.status_code == 200

    def test_x_api_key_works(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/"
        headers = {**ACCEPT, "X-API-Key": mcp_token}
        r = requests.post(url, headers=headers, json=INIT_BODY, timeout=30)
        assert r.status_code == 200

    def test_query_string_works(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/?token={mcp_token}"
        r = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=30)
        assert r.status_code == 200

    def test_options_preflight_not_401(self):
        url = f"{BASE_URL}/api/mcp/"
        r = requests.options(
            url,
            headers={
                "Origin": "https://claude.ai",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=15,
        )
        assert r.status_code != 401, f"OPTIONS returned 401, breaks CORS: {r.status_code}"


class TestFullHandshakeViaPathToken:
    def test_initialize_notifications_toolslist(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/{mcp_token}/"
        # initialize
        r1 = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=30)
        assert r1.status_code == 200
        sid = r1.headers.get("mcp-session-id") or r1.headers.get("Mcp-Session-Id")
        assert sid, f"missing session id, headers={dict(r1.headers)}"
        h = {**ACCEPT, "mcp-session-id": sid}
        # notifications/initialized
        requests.post(
            url, headers=h,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            timeout=10,
        )
        # tools/list
        r3 = requests.post(
            url, headers=h,
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            timeout=30,
        )
        assert r3.status_code == 200
        payload = _parse_mcp_payload(r3)
        assert payload and "result" in payload, f"no result: {r3.text[:400]}"
        tools = payload["result"]["tools"]
        names = {t["name"] for t in tools}
        expected = {"generate_image", "bulk_generate", "get_batch_status",
                    "list_style_presets", "create_style_preset", "list_gallery"}
        assert names == expected, f"tools mismatch: {names}"
        assert len(tools) == 6

    def test_tools_call_list_gallery_returns_absolute_urls(self, mcp_token):
        url = f"{BASE_URL}/api/mcp/{mcp_token}/"
        r1 = requests.post(url, headers=ACCEPT, json=INIT_BODY, timeout=30)
        assert r1.status_code == 200
        sid = r1.headers.get("mcp-session-id") or r1.headers.get("Mcp-Session-Id")
        h = {**ACCEPT, "mcp-session-id": sid}
        requests.post(url, headers=h,
                      json={"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=10)
        r = requests.post(
            url, headers=h,
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": "list_gallery", "arguments": {"limit": 5}}},
            timeout=30,
        )
        assert r.status_code == 200
        payload = _parse_mcp_payload(r)
        assert payload and "result" in payload
        content = payload["result"].get("structuredContent") or payload["result"].get("content")
        gens = None
        if isinstance(content, dict) and "generations" in content:
            gens = content["generations"]
        else:
            for c in content or []:
                if c.get("type") == "text":
                    try:
                        parsed = json.loads(c["text"])
                        if "generations" in parsed:
                            gens = parsed["generations"]
                            break
                    except Exception:
                        continue
        assert gens is not None, f"no generations: {payload}"
        for g in gens:
            assert g["image_url"].startswith("https://"), f"non-https url: {g['image_url']}"


class TestRegenerateInvalidatesOldPathToken:
    def test_regen_updates_path_token(self):
        old = requests.get(f"{BASE_URL}/api/settings", timeout=15).json()["mcp_token"]
        r = requests.post(f"{BASE_URL}/api/settings/mcp/regenerate", timeout=15)
        assert r.status_code == 200
        new = r.json()["mcp_token"]
        assert new != old

        # old token path -> 401
        r_old = requests.post(
            f"{BASE_URL}/api/mcp/{old}/",
            headers=ACCEPT, json=INIT_BODY, timeout=15,
        )
        assert r_old.status_code == 401, f"old token should be invalid but got {r_old.status_code}"

        # new token path -> 200
        r_new = requests.post(
            f"{BASE_URL}/api/mcp/{new}/",
            headers=ACCEPT, json=INIT_BODY, timeout=30,
        )
        assert r_new.status_code == 200

        # /api/settings mcp_connect_path uses new token
        s = requests.get(f"{BASE_URL}/api/settings", timeout=15).json()
        assert s["mcp_connect_path"] == f"/api/mcp/{new}/"
