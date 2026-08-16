"""MCP server exposing image generation tools to Claude via streamable HTTP."""
import os
import logging
import re
from typing import Optional

from mcp.server.mcpserver import MCPServer
from starlette.requests import Request
from starlette.responses import JSONResponse

import service

logger = logging.getLogger(__name__)


def _extract_bearer(header: Optional[str]) -> Optional[str]:
    if not header:
        return None
    parts = header.strip().split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return header.strip()


# Token identifier — the tokens we mint start with this prefix so we can
# safely distinguish them from other URL path segments used by the inner app.
TOKEN_PREFIX = "mcp_"


mcp = None


# Build MCPServer with stateless_http (some versions don't accept the kwarg — fall back)
try:
    mcp = MCPServer(
        name="imagen-studio",
        title="Imagen Studio",
        instructions=(
            "Tools for generating AI images with Google's Gemini image models via Imagen Studio."
        ),
        stateless_http=True,
    )
except TypeError:
    mcp = MCPServer(
        name="imagen-studio",
        title="Imagen Studio",
        instructions=(
            "Tools for generating AI images with Google's Gemini image models via Imagen Studio."
        ),
    )


PUBLIC_BASE_URL = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")


def _absolutize(url: str) -> str:
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL + url
    return url


def _absolutize_record(r: dict) -> dict:
    out = dict(r)
    if "image_url" in out:
        out["image_url"] = _absolutize(out["image_url"])
    if "thumbnail_url" in out:
        out["thumbnail_url"] = _absolutize(out["thumbnail_url"])
    if "reference_image_urls" in out and out["reference_image_urls"]:
        out["reference_image_urls"] = [_absolutize(u) for u in out["reference_image_urls"]]
    return out


# ---------------- tools ----------------

@mcp.tool()
async def generate_image(
    prompt: str,
    model: str = "gemini-3.1-flash-image-preview",
    aspect_ratio: str = "1:1",
    count: int = 1,
    negative_prompt: Optional[str] = None,
    style_preset_id: Optional[str] = None,
    reference_image_url: Optional[str] = None,
    reference_strength: str = "balanced",
) -> dict:
    """Generate 1-4 images from a text prompt using Google's Gemini image models.

    Args:
      prompt: The text description of the image to generate.
      model: One of "gemini-3.1-flash-image-preview" (fast, default) or
             "gemini-3-pro-image-preview" (higher quality, slower).
      aspect_ratio: One of "1:1", "16:9", "9:16", "4:3", "3:4".
      count: Number of images to produce (1-4).
      negative_prompt: Concepts to avoid in the output.
      style_preset_id: Optional id of a saved style preset (call `list_style_presets`).
      reference_image_url: Optional URL of a single reference image to guide style.
      reference_strength: "subtle" | "balanced" | "strong".

    Returns:
      {"images": [{"id", "image_url", "prompt", "model"}], "count": N}
    """
    refs = [reference_image_url] if reference_image_url else None
    records = await service.perform_generate({
        "prompt": prompt,
        "model": model,
        "negative_prompt": negative_prompt,
        "aspect_ratio": aspect_ratio,
        "count": max(1, min(4, int(count))),
        "style_preset_id": style_preset_id,
        "style_suffix": None,
        "reference_image_urls": refs,
        "reference_strength": reference_strength,
    })
    return {
        "images": [_absolutize_record(r) for r in records],
        "count": len(records),
    }


@mcp.tool()
async def bulk_generate(
    prompts: list[str],
    model: str = "gemini-3.1-flash-image-preview",
    aspect_ratio: str = "1:1",
    count_per_prompt: int = 1,
    style_preset_id: Optional[str] = None,
    reference_strength: str = "balanced",
) -> dict:
    """Start a batch that generates images for many prompts. Returns a batch_id.

    Args:
      prompts: A list of text prompts (one image spec per line).
      model: Gemini image model id (see `generate_image`).
      aspect_ratio: Output aspect ratio.
      count_per_prompt: How many images per prompt (1-4).
      style_preset_id: Optional saved style preset to apply to every prompt.
      reference_strength: "subtle" | "balanced" | "strong".

    Returns:
      {"batch_id": "...", "status": "running", "total": N}
      Poll with `get_batch_status(batch_id)` until status=="completed".
    """
    doc = await service.start_batch({
        "prompts": prompts,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "count_per_prompt": max(1, min(4, int(count_per_prompt))),
        "style_preset_id": style_preset_id,
        "reference_strength": reference_strength,
    })
    return {"batch_id": doc["id"], "status": doc["status"], "total": len(doc["items"])}


@mcp.tool()
async def get_batch_status(batch_id: str) -> dict:
    """Return the per-prompt status and finished image URLs of a batch.

    Returns:
      {
        "batch_id": "...",
        "status": "running" | "completed",
        "total": N,
        "done": K,
        "failed": F,
        "items": [{"index", "prompt", "status", "image_urls", "error"}]
      }
    """
    doc = await service.get_batch(batch_id)
    if not doc:
        return {"error": "batch not found"}
    items = [
        {
            "index": it["index"],
            "prompt": it["prompt"],
            "status": it["status"],
            "image_urls": [_absolutize(u) for u in it.get("image_urls") or []],
            "error": it.get("error"),
        }
        for it in doc["items"]
    ]
    done = sum(1 for it in doc["items"] if it["status"] == "done")
    failed = sum(1 for it in doc["items"] if it["status"] == "failed")
    return {
        "batch_id": doc["id"],
        "status": doc["status"],
        "total": len(doc["items"]),
        "done": done,
        "failed": failed,
        "items": items,
    }


@mcp.tool()
async def list_style_presets() -> dict:
    """List all saved reference-based style presets that the user has created.

    Returns:
      {"presets": [{"id", "name", "thumbnail_url", "style_description", "reference_strength"}]}
    """
    presets = await service.list_style_presets()
    return {
        "presets": [
            {
                "id": p["id"],
                "name": p["name"],
                "thumbnail_url": _absolutize(p.get("thumbnail_url") or ""),
                "style_description": p.get("style_description") or "",
                "reference_strength": p.get("reference_strength") or "balanced",
            }
            for p in presets
        ]
    }


@mcp.tool()
async def create_style_preset(
    name: str,
    reference_image_url: str,
    reference_strength: str = "balanced",
) -> dict:
    """Create a new named style preset from a reference image URL.

    The reference image is auto-analysed by Gemini vision to extract a style description
    (lighting, palette, mood, camera, composition) which is then reused in future generations.

    Returns:
      {"id", "name", "style_description", "thumbnail_url", "reference_strength"}
    """
    preset = await service.create_style_preset(
        name=name,
        reference_image_urls=[reference_image_url],
        style_description=None,
        reference_strength=reference_strength,
    )
    return {
        "id": preset["id"],
        "name": preset["name"],
        "style_description": preset["style_description"],
        "thumbnail_url": _absolutize(preset["thumbnail_url"]),
        "reference_strength": preset["reference_strength"],
    }


@mcp.tool()
async def list_gallery(limit: int = 20, offset: int = 0) -> dict:
    """List recent generated images with their prompts and URLs.

    Args:
      limit: Max number of records to return (default 20, max 100).
      offset: Skip this many records for pagination.
    """
    limit = max(1, min(100, int(limit)))
    docs = await service.list_gallery(limit=limit, offset=max(0, int(offset)))
    return {
        "generations": [
            {
                "id": d["id"],
                "image_url": _absolutize(d["image_url"]),
                "prompt": d["prompt"],
                "model": d["model"],
                "aspect_ratio": d.get("aspect_ratio"),
                "created_at": d.get("created_at"),
            }
            for d in docs
        ]
    }


def build_mcp_asgi_app():
    """Return the ASGI app to mount at /api/mcp.

    Supports FOUR auth modes so it works from any client, including claude.ai's
    custom-connector UI which does not expose a Bearer token field:
      1. `X-API-Key: <token>` header
      2. `Authorization: Bearer <token>` header
      3. `?token=<token>` query string
      4. Token embedded in URL path as the first segment, e.g.
         `/api/mcp/mcp_abc123.../` — the wrapper strips it before forwarding.
    """
    from mcp.server.transport_security import TransportSecuritySettings
    security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    inner = mcp.streamable_http_app(streamable_http_path="/", transport_security=security)

    def _unauthorized_for(request_path: str) -> JSONResponse:
        """Return 401 with WWW-Authenticate so MCP clients discover our OAuth flow."""
        public_base = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
        resource_meta = (
            f"{public_base}/api/.well-known/oauth-protected-resource"
            if public_base
            else "/api/.well-known/oauth-protected-resource"
        )
        return JSONResponse(
            {"error": "unauthorized"},
            status_code=401,
            headers={
                # RFC 6750 + RFC 9728 challenge — points MCP clients (Claude) at
                # our OAuth authorization server metadata.
                "WWW-Authenticate": f'Bearer resource_metadata="{resource_meta}"',
            },
        )

    async def app(scope, receive, send):
        # Non-http (lifespan, websocket) → pass through
        if scope["type"] != "http":
            return await inner(scope, receive, send)

        # OPTIONS/CORS pre-flight → pass through (inner responds)
        if scope.get("method") == "OPTIONS":
            return await inner(scope, receive, send)

        expected = await service.get_mcp_token(create_if_missing=True)

        provided: Optional[str] = None
        original_path = scope.get("path", "/")

        # 1) headers
        for h_name, h_val in scope.get("headers") or []:
            n = h_name.decode().lower()
            v = h_val.decode()
            if n == "x-api-key":
                provided = v.strip()
                break
            if n == "authorization":
                bearer = _extract_bearer(v)
                if bearer:
                    provided = bearer
                    break

        # 2) query string
        if not provided:
            qs = (scope.get("query_string") or b"").decode()
            for pair in qs.split("&"):
                if pair.startswith("token="):
                    provided = pair.split("=", 1)[1]
                    break

        # 3) path prefix: e.g. /mcp_abc123/... — or the full /api/mcp/mcp_abc123/...
        # The mounted app may see either the stripped or full path depending on
        # ASGI stack — accept both.
        path = original_path
        if not provided:
            m = re.search(r"/(" + TOKEN_PREFIX + r"[A-Za-z0-9]+)(/.*)?$", path)
            if m:
                provided = m.group(1)
                # Rewrite path to strip the token segment so inner app sees "/" or the tail
                new_path = m.group(2) or "/"
                scope = {**scope, "path": new_path, "raw_path": new_path.encode()}

        if expected and provided == expected:
            return await inner(scope, receive, send)

        response = _unauthorized_for(original_path)
        return await response(scope, receive, send)

    return app


def get_session_manager():
    return mcp.session_manager
