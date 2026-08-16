"""Minimal OAuth 2.0 authorization server so that claude.ai can register
this Imagen Studio MCP server as a custom connector without asking the user
for any OAuth Client ID / Client Secret.

Flow implemented (RFC 6749 + 7591 + PKCE):

  1. Client hits `/.well-known/oauth-authorization-server` → metadata.
  2. Client POSTs to `/oauth/register` (Dynamic Client Registration) → we accept
     anything and return a static-ish client_id/client_secret.
  3. Client redirects the user to `/oauth/authorize?...` — we auto-approve and
     immediately redirect back to `redirect_uri` with `code=...&state=...`.
  4. Client exchanges the code at `/oauth/token`; we return the pre-configured
     MCP token as the `access_token`. PKCE (S256) is verified.

The `access_token` handed out is the same value shown in the app's Settings
page, so the existing MCPAuthMiddleware (Bearer auth) accepts it as-is.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import time
from typing import Optional
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

import service

router = APIRouter(prefix="/api")

# ------------------------------------------------------------------
# In-memory stores. This app is a single-process supervisor service, so
# in-memory is fine; codes are short-lived anyway.
# ------------------------------------------------------------------
_CLIENTS: dict[str, dict] = {}
_CODES: dict[str, dict] = {}     # code -> {client_id, redirect_uri, code_challenge, code_challenge_method, exp}

CODE_TTL_SECONDS = 300           # 5 minutes


def _issuer(request: Request) -> str:
    """Public base URL for this OAuth authorization server.

    Includes `/api` because the Kubernetes ingress only routes `/api/*` to the
    backend — all our OAuth endpoints therefore live under `/api/`.
    """
    override = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    if override:
        return override + "/api"
    base = str(request.base_url).rstrip("/")
    return base + "/api"


# ------------------------------------------------------------------
# .well-known metadata
# ------------------------------------------------------------------
def _oauth_metadata(iss: str) -> dict:
    return {
        "issuer": iss,
        "authorization_endpoint": f"{iss}/oauth/authorize",
        "token_endpoint": f"{iss}/oauth/token",
        "registration_endpoint": f"{iss}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256", "plain"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
        "scopes_supported": ["mcp"],
    }


@router.get("/.well-known/oauth-authorization-server")
async def oauth_metadata(request: Request):
    return _oauth_metadata(_issuer(request))


@router.get("/.well-known/oauth-protected-resource")
async def protected_resource_metadata(request: Request):
    iss = _issuer(request)
    return {
        "resource": f"{iss}/mcp",
        "authorization_servers": [iss],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["mcp"],
    }


# ------------------------------------------------------------------
# Dynamic Client Registration (RFC 7591)
# ------------------------------------------------------------------
@router.post("/oauth/register")
async def dcr(request: Request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    client_id = "imagen-studio-" + secrets.token_urlsafe(8)
    client_secret = secrets.token_urlsafe(32)
    _CLIENTS[client_id] = {
        "client_secret": client_secret,
        "redirect_uris": body.get("redirect_uris") or [],
        "client_name": body.get("client_name") or "unknown",
    }
    return JSONResponse(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "client_id_issued_at": int(time.time()),
            "client_secret_expires_at": 0,
            "redirect_uris": body.get("redirect_uris") or [],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
        status_code=201,
    )


# ------------------------------------------------------------------
# Authorization endpoint — auto-approves for the app owner (no login screen).
# ------------------------------------------------------------------
@router.get("/oauth/authorize")
async def authorize(
    request: Request,
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    state: Optional[str] = Query(None),
    code_challenge: Optional[str] = Query(None),
    code_challenge_method: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),  # noqa: ARG001 (kept for spec compliance)
):
    if response_type != "code":
        raise HTTPException(status_code=400, detail="unsupported_response_type")

    # Accept any client_id — we lazily register if unknown so that clients that
    # don't call /oauth/register (rare) still work.
    if client_id not in _CLIENTS:
        _CLIENTS[client_id] = {"client_secret": None, "redirect_uris": [redirect_uri], "client_name": "auto"}

    # Redirect URIs must be http(s) — reject exotic schemes.
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="invalid_redirect_uri")

    code = secrets.token_urlsafe(32)
    _CODES[code] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": (code_challenge_method or "plain").lower(),
        "exp": time.time() + CODE_TTL_SECONDS,
    }

    params = {"code": code}
    if state:
        params["state"] = state
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(url=f"{redirect_uri}{sep}{urlencode(params)}", status_code=302)


# ------------------------------------------------------------------
# Token endpoint
# ------------------------------------------------------------------
def _verify_pkce(challenge: Optional[str], method: str, verifier: Optional[str]) -> bool:
    if not challenge:
        # No PKCE requested at /authorize — allow (some clients skip PKCE)
        return True
    if not verifier:
        return False
    if method == "s256":
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        return secrets.compare_digest(computed, challenge)
    # plain
    return secrets.compare_digest(verifier, challenge)


@router.post("/oauth/token")
async def token(
    request: Request,
    grant_type: str = Form(...),
    code: Optional[str] = Form(None),
    redirect_uri: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    client_secret: Optional[str] = Form(None),  # noqa: ARG001 (accepted for spec, not enforced)
    code_verifier: Optional[str] = Form(None),
    refresh_token: Optional[str] = Form(None),
):
    mcp_token = await service.get_mcp_token(create_if_missing=True)

    if grant_type == "refresh_token":
        # We hand out the same access token every time — no rotation.
        if not refresh_token:
            raise HTTPException(status_code=400, detail="invalid_grant")
        return JSONResponse(
            {
                "access_token": mcp_token,
                "token_type": "Bearer",
                "expires_in": 60 * 60 * 24 * 365,
                "refresh_token": mcp_token,
                "scope": "mcp",
            }
        )

    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="unsupported_grant_type")

    if not code or code not in _CODES:
        raise HTTPException(status_code=400, detail="invalid_grant")

    entry = _CODES.pop(code)  # single-use
    if entry["exp"] < time.time():
        raise HTTPException(status_code=400, detail="invalid_grant")
    if redirect_uri and redirect_uri != entry["redirect_uri"]:
        raise HTTPException(status_code=400, detail="invalid_grant")
    if client_id and client_id != entry["client_id"]:
        raise HTTPException(status_code=400, detail="invalid_client")
    if not _verify_pkce(entry.get("code_challenge"), entry.get("code_challenge_method", "plain"), code_verifier):
        raise HTTPException(status_code=400, detail="invalid_grant")

    return JSONResponse(
        {
            "access_token": mcp_token,
            "token_type": "Bearer",
            "expires_in": 60 * 60 * 24 * 365,
            "refresh_token": mcp_token,
            "scope": "mcp",
        }
    )
