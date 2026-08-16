"""Main FastAPI application for the Imagen Studio."""
import io
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import Response, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("imagen-studio")

# Local modules (imported AFTER load_dotenv so env vars are available)
import service  # noqa: E402
import gen as gen_module  # noqa: E402
import storage as storage_module  # noqa: E402
import mcp_app  # noqa: E402
from models import (  # noqa: E402
    GenerateRequest,
    BulkGenerateRequest,
    CreateStylePresetRequest,
    UpdateStylePresetRequest,
    AnalyzeReferenceRequest,
    AnalyzeMultipleReferencesRequest,
    RemixRequest,
    CreateCollectionRequest,
    SettingsUpdateRequest,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warm up object storage session and MCP session manager
    try:
        storage_module.init_storage()
        logger.info("Object storage initialised")
    except Exception as e:
        logger.error("Storage init failed: %s", e)

    # Ensure MCP token exists
    try:
        token = await service.get_mcp_token(create_if_missing=True)
        logger.info("MCP token ready (%s...)", token[:8])
    except Exception as e:
        logger.error("MCP token bootstrap failed: %s", e)

    # Run the MCP streamable http session manager for the lifetime of the app
    sm = mcp_app.get_session_manager()
    async with sm.run():
        yield


app = FastAPI(title="Imagen Studio", lifespan=lifespan)
api_router = APIRouter(prefix="/api")


# ---------------- meta ----------------
@api_router.get("/")
async def root():
    return {"service": "Imagen Studio", "ok": True}


@api_router.get("/models")
async def list_models():
    return {"models": gen_module.MODELS_META}


@api_router.get("/aspect-ratios")
async def list_aspect_ratios():
    return {"ratios": list(gen_module.ASPECT_RATIO_HINTS.keys())}


# ---------------- generation ----------------
@api_router.post("/generate")
async def generate(req: GenerateRequest):
    try:
        records = await service.perform_generate(req.model_dump())
        return {"images": records}
    except Exception as e:
        logger.exception("generate failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------- bulk ----------------
@api_router.post("/bulk")
async def bulk_start(req: BulkGenerateRequest):
    try:
        doc = await service.start_batch(req.model_dump())
        return doc
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("bulk_start failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/bulk")
async def bulk_list(limit: int = 50, offset: int = 0):
    docs = await service.list_batches(limit=limit, offset=offset)
    return {"batches": docs}


@api_router.get("/bulk/{batch_id}")
async def bulk_status(batch_id: str):
    doc = await service.get_batch(batch_id)
    if not doc:
        raise HTTPException(status_code=404, detail="batch not found")
    return doc


@api_router.get("/bulk/{batch_id}/zip")
async def bulk_zip(batch_id: str):
    data = await service.build_batch_zip(batch_id)
    if not data:
        raise HTTPException(status_code=404, detail="batch not found")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="batch-{batch_id[:8]}.zip"'},
    )


# ---------------- gallery ----------------
@api_router.get("/gallery")
async def gallery(limit: int = 60, offset: int = 0):
    docs = await service.list_gallery(limit=limit, offset=offset)
    return {"generations": docs}


@api_router.get("/gallery/{gen_id}")
async def gallery_get(gen_id: str):
    doc = await service.get_generation(gen_id)
    if not doc:
        raise HTTPException(status_code=404, detail="not found")
    return doc


@api_router.delete("/gallery/{gen_id}")
async def gallery_delete(gen_id: str):
    ok = await service.delete_generation(gen_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}


# ---------------- references ----------------
@api_router.post("/references/upload")
async def upload_reference(file: UploadFile = File(...)):
    data = await file.read()
    content_type = file.content_type or "image/png"
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="must upload an image")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="image too large (>15MB)")
    res = await service.store_uploaded_reference(data, content_type)
    return res


@api_router.post("/references/analyze")
async def analyze_reference(req: AnalyzeReferenceRequest):
    try:
        desc = await service.analyze_reference_from_url(req.reference_image_url)
        return {"style_description": desc}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("analyze_reference failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/references/analyze-multi")
async def analyze_reference_multi(req: AnalyzeMultipleReferencesRequest):
    try:
        desc = await service.analyze_references_multi(req.reference_image_urls)
        return {"style_description": desc}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("analyze_references_multi failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/gallery/{gen_id}/remix")
async def gallery_remix(gen_id: str, req: RemixRequest):
    try:
        prompts = await service.remix_generation_prompt(gen_id, n=req.n or 10)
        return {"prompts": prompts, "count": len(prompts)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("remix failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/share/{gen_id}")
async def public_share(gen_id: str):
    """Public read-only view of a single generation. No auth required."""
    doc = await service.get_generation(gen_id)
    if not doc:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "id": doc["id"],
        "image_url": doc["image_url"],
        "prompt": doc["prompt"],
        "model": doc.get("model"),
        "aspect_ratio": doc.get("aspect_ratio"),
        "created_at": doc.get("created_at"),
    }


# ---------------- collections ----------------
@api_router.get("/collections")
async def collections_list():
    return {"collections": await service.list_collections()}


@api_router.post("/collections")
async def collections_create(req: CreateCollectionRequest):
    return await service.create_collection(req.name, req.description)


@api_router.delete("/collections/{collection_id}")
async def collections_delete(collection_id: str):
    ok = await service.delete_collection(collection_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}


@api_router.post("/collections/{collection_id}/presets/{preset_id}")
async def collections_add_preset(collection_id: str, preset_id: str):
    ok = await service.assign_preset_to_collection(preset_id, collection_id)
    if not ok:
        raise HTTPException(status_code=404, detail="preset not found")
    return {"ok": True}


@api_router.delete("/collections/{collection_id}/presets/{preset_id}")
async def collections_remove_preset(collection_id: str, preset_id: str):
    ok = await service.assign_preset_to_collection(preset_id, None)
    if not ok:
        raise HTTPException(status_code=404, detail="preset not found")
    return {"ok": True}


# ---------------- style presets ----------------
@api_router.get("/style-presets")
async def style_presets_list(collection_id: Optional[str] = None):
    return {"presets": await service.list_style_presets(collection_id=collection_id)}


@api_router.post("/style-presets")
async def style_presets_create(req: CreateStylePresetRequest):
    try:
        preset = await service.create_style_preset(
            name=req.name,
            reference_image_urls=req.reference_image_urls,
            style_description=req.style_description,
            reference_strength=req.reference_strength or "balanced",
            collection_id=req.collection_id,
        )
        return preset
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("create preset failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/style-presets/{preset_id}")
async def style_presets_get(preset_id: str):
    p = await service.get_style_preset(preset_id)
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    return p


@api_router.delete("/style-presets/{preset_id}")
async def style_presets_delete(preset_id: str):
    ok = await service.delete_style_preset(preset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}


# ---------------- image serving from object storage ----------------
@api_router.get("/images/{path:path}")
async def serve_image(path: str):
    try:
        data, ct = await service.fetch_image_bytes(path)
    except Exception as e:
        logger.warning("image fetch failed %s: %s", path, e)
        raise HTTPException(status_code=404, detail="image not found")
    return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=31536000"})


# ---------------- settings ----------------
@api_router.get("/settings")
async def settings_get():
    # Never return the actual key value — just whether one is set. Return MCP token.
    from db import settings_col
    doc = await settings_col.find_one({"_id": "singleton"}) or {}
    return {
        "gemini_api_key_set": bool(doc.get("gemini_api_key")),
        "gemini_api_key_source": "user_override" if doc.get("gemini_api_key") else "emergent_universal",
        "mcp_token": await service.get_mcp_token(create_if_missing=True),
        "mcp_endpoint": "/api/mcp",
    }


@api_router.post("/settings")
async def settings_update(req: SettingsUpdateRequest):
    if req.gemini_api_key is not None:
        await service.update_gemini_key(req.gemini_api_key)
    return await settings_get()


@api_router.post("/settings/mcp/regenerate")
async def mcp_regenerate():
    token = await service.regenerate_mcp_token()
    return {"mcp_token": token}


# ---------------- mount router ----------------
app.include_router(api_router)

# Mount MCP server ASGI app at /api/mcp (streamable HTTP) — with auth middleware.
# The Kubernetes ingress routes only /api/* to the backend, so the MCP endpoint
# is publicly reachable at {PUBLIC_APP_URL}/api/mcp.
mcp_asgi = mcp_app.build_mcp_asgi_app()
app.mount("/api/mcp", mcp_asgi)


# CORS (mounted apps inherit the app-level CORS on parent app; mcp mount is separate)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    from db import client
    client.close()
