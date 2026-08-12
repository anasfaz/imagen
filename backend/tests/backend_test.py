"""Backend integration tests for Imagen Studio.

Covers: meta endpoints, generation, references, style presets, bulk batch, gallery,
settings, and MCP transport (auth + initialize + tools/list + tools/call).
"""
import io
import os
import time
import base64
import struct
import zlib
import json
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://imagen-studio-12.preview.emergentagent.com").rstrip("/")


def _tiny_png_bytes() -> bytes:
    """Return a minimal valid 2x2 red PNG."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)  # 2x2 RGB
    # raw scanline: filter=0 then 2 pixels
    raw = b"\x00\xff\x00\x00\xff\x00\x00" + b"\x00\xff\x00\x00\xff\x00\x00"
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api(base_url):
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# ------------------- meta -------------------
class TestMeta:
    def test_root(self, api, base_url):
        r = api.get(f"{base_url}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_models(self, api, base_url):
        r = api.get(f"{base_url}/api/models", timeout=15)
        assert r.status_code == 200
        ids = {m["id"] for m in r.json()["models"]}
        assert "gemini-3.1-flash-image-preview" in ids
        assert "gemini-3-pro-image-preview" in ids

    def test_aspect_ratios(self, api, base_url):
        r = api.get(f"{base_url}/api/aspect-ratios", timeout=15)
        assert r.status_code == 200
        ratios = r.json()["ratios"]
        for e in ["1:1", "16:9", "9:16", "4:3", "3:4"]:
            assert e in ratios


# ------------------- settings -------------------
class TestSettings:
    def test_settings_get(self, api, base_url):
        r = api.get(f"{base_url}/api/settings", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "gemini_api_key_set" in data
        assert data["mcp_endpoint"] == "/api/mcp"
        assert isinstance(data["mcp_token"], str) and len(data["mcp_token"]) > 8

    def test_mcp_regenerate(self, api, base_url):
        old = api.get(f"{base_url}/api/settings", timeout=15).json()["mcp_token"]
        r = api.post(f"{base_url}/api/settings/mcp/regenerate", timeout=15)
        assert r.status_code == 200
        new = r.json()["mcp_token"]
        assert new and new != old
        # confirm persisted
        cur = api.get(f"{base_url}/api/settings", timeout=15).json()["mcp_token"]
        assert cur == new

    def test_settings_update_key(self, api, base_url):
        r = api.post(f"{base_url}/api/settings", json={"gemini_api_key": "TEST_fake_key_123"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["gemini_api_key_set"] is True
        assert d["gemini_api_key_source"] == "user_override"
        # revert (clear)
        r2 = api.post(f"{base_url}/api/settings", json={"gemini_api_key": ""}, timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["gemini_api_key_set"] is False
        assert d2["gemini_api_key_source"] == "emergent_universal"


# ------------------- references + presets -------------------
@pytest.fixture(scope="session")
def uploaded_reference(api, base_url):
    png = _tiny_png_bytes()
    files = {"file": ("ref.png", png, "image/png")}
    r = api.post(f"{base_url}/api/references/upload", files=files, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "storage_path" in body and "image_url" in body
    assert body["image_url"].startswith("/api/images/")
    return body


class TestReferences:
    def test_upload(self, uploaded_reference):
        assert uploaded_reference["image_url"].startswith("/api/images/")

    def test_serve_image(self, api, base_url, uploaded_reference):
        r = api.get(f"{base_url}{uploaded_reference['image_url']}", timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/")
        assert len(r.content) > 0

    def test_analyze(self, api, base_url, uploaded_reference):
        r = api.post(
            f"{base_url}/api/references/analyze",
            json={"reference_image_url": uploaded_reference["image_url"]},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        desc = r.json().get("style_description")
        assert isinstance(desc, str) and len(desc) > 0


@pytest.fixture(scope="session")
def created_preset(api, base_url, uploaded_reference):
    payload = {
        "name": f"TEST_preset_{uuid.uuid4().hex[:6]}",
        "reference_image_urls": [uploaded_reference["image_url"]],
        "reference_strength": "balanced",
    }
    r = api.post(f"{base_url}/api/style-presets", json=payload, timeout=90)
    assert r.status_code == 200, r.text
    preset = r.json()
    assert preset["id"] and preset["name"] == payload["name"]
    assert preset["thumbnail_url"]
    assert isinstance(preset["style_description"], str)
    assert preset["reference_strength"] == "balanced"
    return preset


class TestPresets:
    def test_list_contains(self, api, base_url, created_preset):
        r = api.get(f"{base_url}/api/style-presets", timeout=15)
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()["presets"]}
        assert created_preset["id"] in ids

    def test_delete(self, api, base_url, uploaded_reference):
        # Create a throwaway preset then delete
        payload = {
            "name": f"TEST_del_{uuid.uuid4().hex[:6]}",
            "reference_image_urls": [uploaded_reference["image_url"]],
            "style_description": "test style, minimal",
            "reference_strength": "subtle",
        }
        r = api.post(f"{base_url}/api/style-presets", json=payload, timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        rd = api.delete(f"{base_url}/api/style-presets/{pid}", timeout=15)
        assert rd.status_code == 200
        # confirm gone
        rg = api.get(f"{base_url}/api/style-presets/{pid}", timeout=15)
        assert rg.status_code == 404


# ------------------- generation -------------------
@pytest.fixture(scope="session")
def generated_image(api, base_url):
    r = api.post(
        f"{base_url}/api/generate",
        json={"prompt": "a small red apple on a white table", "count": 1, "aspect_ratio": "1:1"},
        timeout=180,
    )
    assert r.status_code == 200, r.text
    images = r.json()["images"]
    assert len(images) >= 1
    rec = images[0]
    for k in ["id", "image_url", "prompt", "model", "aspect_ratio", "created_at"]:
        assert k in rec, f"missing {k}"
    assert rec["image_url"].startswith("/api/images/")
    return rec


class TestGenerate:
    def test_image_served(self, api, base_url, generated_image):
        r = api.get(f"{base_url}{generated_image['image_url']}", timeout=30)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/")
        assert len(r.content) > 100

    def test_generate_with_preset(self, api, base_url, created_preset):
        r = api.post(
            f"{base_url}/api/generate",
            json={
                "prompt": "a green cactus in the sunlight",
                "count": 1,
                "aspect_ratio": "1:1",
                "style_preset_id": created_preset["id"],
            },
            timeout=180,
        )
        assert r.status_code == 200, r.text
        images = r.json()["images"]
        assert len(images) >= 1
        assert images[0].get("style_preset_id") == created_preset["id"]


# ------------------- gallery -------------------
class TestGallery:
    def test_gallery_list(self, api, base_url, generated_image):
        r = api.get(f"{base_url}/api/gallery", timeout=15)
        assert r.status_code == 200
        gens = r.json()["generations"]
        assert isinstance(gens, list) and len(gens) >= 1
        ids = [g["id"] for g in gens]
        assert generated_image["id"] in ids
        # reverse chronological -> the newest generation should not be later than the first item
        assert gens[0]["created_at"] >= gens[-1]["created_at"]

    def test_gallery_delete(self, api, base_url):
        # generate a throwaway then delete
        r = api.post(
            f"{base_url}/api/generate",
            json={"prompt": "TEST tiny blue circle", "count": 1, "aspect_ratio": "1:1"},
            timeout=180,
        )
        assert r.status_code == 200
        gid = r.json()["images"][0]["id"]
        rd = api.delete(f"{base_url}/api/gallery/{gid}", timeout=15)
        assert rd.status_code == 200
        rlist = api.get(f"{base_url}/api/gallery?limit=100", timeout=15)
        ids = {g["id"] for g in rlist.json()["generations"]}
        assert gid not in ids


# ------------------- bulk -------------------
class TestBulk:
    def test_bulk_flow(self, api, base_url):
        prompts = ["a small yellow duck", "a snowy mountain peak at dawn"]
        r = api.post(
            f"{base_url}/api/bulk",
            json={"prompts": prompts, "count_per_prompt": 1, "aspect_ratio": "1:1"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["status"] == "running"
        assert len(doc["items"]) == 2
        assert all(it["status"] == "pending" for it in doc["items"])
        batch_id = doc["id"]

        # poll up to ~150s
        completed = False
        deadline = time.time() + 180
        last = doc
        while time.time() < deadline:
            time.sleep(6)
            rr = api.get(f"{base_url}/api/bulk/{batch_id}", timeout=15)
            assert rr.status_code == 200
            last = rr.json()
            if last["status"] == "completed":
                completed = True
                break
        assert completed, f"batch did not complete, last={last.get('status')}"
        done_items = [it for it in last["items"] if it["status"] == "done"]
        assert len(done_items) >= 1, f"no done items: {last}"
        for it in done_items:
            assert it.get("image_urls"), "done item missing image_urls"

        # ZIP
        rz = api.get(f"{base_url}/api/bulk/{batch_id}/zip", timeout=60)
        assert rz.status_code == 200
        assert rz.headers["content-type"].startswith("application/zip")
        assert rz.content[:2] == b"PK", "not a zip"


# ------------------- MCP -------------------
class TestMCP:
    @pytest.fixture(scope="class")
    def mcp_url(self, base_url):
        return f"{base_url}/api/mcp/"

    @pytest.fixture(scope="class")
    def mcp_token(self, base_url):
        r = requests.get(f"{base_url}/api/settings", timeout=15)
        return r.json()["mcp_token"]

    def test_no_auth_returns_401(self, mcp_url):
        r = requests.post(mcp_url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize"}, timeout=15)
        assert r.status_code == 401

    def test_initialize_and_tools(self, mcp_url, mcp_token):
        headers = {
            "Authorization": f"Bearer {mcp_token}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        # initialize handshake
        init_body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "0.1"},
            },
        }
        r = requests.post(mcp_url, headers=headers, json=init_body, timeout=30)
        assert r.status_code == 200, f"init failed: {r.status_code} {r.text[:400]}"
        sid = r.headers.get("mcp-session-id") or r.headers.get("Mcp-Session-Id")
        # optional notifications/initialized
        h2 = dict(headers)
        if sid:
            h2["mcp-session-id"] = sid
        requests.post(mcp_url, headers=h2, json={"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=10)

        # tools/list
        r2 = requests.post(
            mcp_url,
            headers=h2,
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text[:400]
        text = r2.text
        # Response may be SSE (text/event-stream) — extract JSON payload
        payload = None
        ct = r2.headers.get("content-type", "")
        if "text/event-stream" in ct:
            for line in text.splitlines():
                if line.startswith("data:"):
                    try:
                        payload = json.loads(line[5:].strip())
                        break
                    except Exception:
                        pass
        else:
            payload = r2.json()
        assert payload, f"no payload parsed from tools/list: {text[:400]}"
        tools = payload["result"]["tools"]
        names = {t["name"] for t in tools}
        expected = {"generate_image", "bulk_generate", "get_batch_status",
                    "list_style_presets", "create_style_preset", "list_gallery"}
        assert names == expected, f"tool set mismatch: got {names}"

        # tools/call list_gallery
        r3 = requests.post(
            mcp_url,
            headers=h2,
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": "list_gallery", "arguments": {"limit": 5}}},
            timeout=30,
        )
        assert r3.status_code == 200
        payload3 = None
        if "text/event-stream" in r3.headers.get("content-type", ""):
            for line in r3.text.splitlines():
                if line.startswith("data:"):
                    try:
                        payload3 = json.loads(line[5:].strip())
                        break
                    except Exception:
                        pass
        else:
            payload3 = r3.json()
        assert payload3 and "result" in payload3, f"no result: {r3.text[:400]}"
        # structured content should contain generations with absolute URLs
        # Response is TextContent with JSON string; parse if needed
        content = payload3["result"].get("structuredContent") or payload3["result"].get("content")
        # Try to find generations
        found = False
        if isinstance(content, dict) and "generations" in content:
            gens = content["generations"]
            found = True
        else:
            # content is list of TextContent
            for c in content or []:
                if c.get("type") == "text":
                    try:
                        parsed = json.loads(c["text"])
                        if "generations" in parsed:
                            gens = parsed["generations"]
                            found = True
                            break
                    except Exception:
                        continue
        assert found, f"no generations in result: {payload3}"
        # verify URLs are absolute (https://) if any generations exist
        for g in gens:
            assert g["image_url"].startswith("http"), f"non-absolute url: {g['image_url']}"
