"""Business logic for image generation, style presets and bulk batches."""
import asyncio
import base64
import io
import logging
import os
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional

from db import db, generations, batches, style_presets, settings_col
import gen
import storage

logger = logging.getLogger(__name__)

APP_NAME = "imagen-studio"
DEFAULT_USER = "public"
BULK_CONCURRENCY = 3          # simultaneous prompt workers per batch
PROMPT_MAX_RETRIES = 2
RESERVED_PRESET_IDS = {"none"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------- settings & api-key -----------------
async def get_effective_api_key() -> str:
    """Prefer user-supplied Gemini key from DB; fall back to Emergent universal key."""
    doc = await settings_col.find_one({"_id": "singleton"})
    key = (doc or {}).get("gemini_api_key")
    if key:
        return key
    return os.environ.get("EMERGENT_LLM_KEY", "")


async def update_gemini_key(new_key: Optional[str]) -> None:
    if new_key is None or new_key == "":
        await settings_col.update_one(
            {"_id": "singleton"},
            {"$unset": {"gemini_api_key": ""}, "$set": {"updated_at": _now()}},
            upsert=True,
        )
    else:
        await settings_col.update_one(
            {"_id": "singleton"},
            {"$set": {"gemini_api_key": new_key, "updated_at": _now()}},
            upsert=True,
        )


async def get_mcp_token(create_if_missing: bool = True) -> str:
    doc = await settings_col.find_one({"_id": "singleton"})
    token = (doc or {}).get("mcp_token")
    if not token and create_if_missing:
        token = "mcp_" + uuid.uuid4().hex + uuid.uuid4().hex[:8]
        await settings_col.update_one(
            {"_id": "singleton"},
            {"$set": {"mcp_token": token, "mcp_token_created_at": _now()}},
            upsert=True,
        )
    return token or ""


async def regenerate_mcp_token() -> str:
    token = "mcp_" + uuid.uuid4().hex + uuid.uuid4().hex[:8]
    await settings_col.update_one(
        {"_id": "singleton"},
        {"$set": {"mcp_token": token, "mcp_token_created_at": _now()}},
        upsert=True,
    )
    return token


# ----------------- storage helpers -----------------
def _storage_path_for(kind: str, ext: str = "png") -> str:
    return f"{APP_NAME}/{kind}/{uuid.uuid4()}.{ext}"


async def store_image_bytes(image_bytes: bytes, kind: str = "generations", content_type: str = "image/png") -> str:
    """Save bytes to object storage and return storage path."""
    ext = "png" if "png" in content_type else ("jpg" if "jpeg" in content_type or "jpg" in content_type else "bin")
    path = _storage_path_for(kind, ext)
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, lambda: storage.put_object(path, image_bytes, content_type))
    return result["path"]


async def fetch_image_bytes(path: str) -> tuple[bytes, str]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: storage.get_object(path))


def public_image_url(path: str) -> str:
    """Backend-served URL for images. path is the storage_path returned by object storage."""
    return f"/api/images/{path}"


# ----------------- style presets -----------------
STRENGTH_TO_PHRASING = {
    "subtle": "Take subtle inspiration from the reference style below (~30%). Apply light hints of its lighting and palette but do not slavishly copy.",
    "balanced": "Match the reference style described below closely — lighting, colour palette, mood, and rendering should feel consistent with it.",
    "strong": "Faithfully replicate the reference style described below. Lighting, colour grade, camera characteristics, mood and rendering should be almost identical.",
}


async def _resolve_style_suffix(*, style_preset_id: Optional[str], extra_style_suffix: Optional[str], strength: Optional[str]) -> tuple[Optional[str], Optional[list[str]]]:
    """Return (style_suffix_text, list_of_reference_paths_or_urls_for_context)."""
    parts: list[str] = []
    ref_paths: list[str] = []
    if style_preset_id and style_preset_id not in RESERVED_PRESET_IDS:
        preset = await style_presets.find_one({"id": style_preset_id})
        if preset:
            strength_key = strength or preset.get("reference_strength") or "balanced"
            strength_phrase = STRENGTH_TO_PHRASING.get(strength_key, STRENGTH_TO_PHRASING["balanced"])
            desc = (preset.get("style_description") or "").strip()
            if desc:
                parts.append(f"{strength_phrase}\nReference style: {desc}")
            ref_paths.extend(preset.get("reference_image_paths") or [])
    if extra_style_suffix:
        parts.append(extra_style_suffix)
    return ("\n".join(parts) if parts else None, ref_paths or None)


async def _paths_to_base64(paths: list[str]) -> list[str]:
    """Fetch reference image bytes from storage and return as base64 strings."""
    out = []
    for p in paths:
        try:
            data, _ct = await fetch_image_bytes(p)
            out.append(base64.b64encode(data).decode("utf-8"))
        except Exception as e:
            logger.warning("failed to load reference %s: %s", p, e)
    return out


async def create_style_preset(*, name: str, reference_image_urls: list[str], style_description: Optional[str], reference_strength: str = "balanced") -> dict:
    """Analyze the first reference image if no description supplied, then save."""
    # reference_image_urls are backend URLs like /api/images/<path>. Extract storage paths.
    ref_paths = [_url_to_storage_path(u) for u in reference_image_urls]
    ref_paths = [p for p in ref_paths if p]

    if not ref_paths:
        raise ValueError("no valid reference_image_urls supplied")

    if not style_description:
        b64_list = await _paths_to_base64(ref_paths[:1])
        if b64_list:
            api_key = await get_effective_api_key()
            try:
                style_description = await gen.analyze_reference_style(b64_list[0], api_key_override=api_key)
            except Exception as e:
                logger.exception("analyze_reference_style failed: %s", e)
                style_description = "A distinctive visual style extracted from the reference image."

    preset = {
        "id": str(uuid.uuid4()),
        "name": name,
        "reference_image_paths": ref_paths,
        "reference_image_urls": [public_image_url(p) for p in ref_paths],
        "thumbnail_url": public_image_url(ref_paths[0]),
        "style_description": style_description or "",
        "reference_strength": reference_strength,
        "created_at": _now(),
    }
    await style_presets.insert_one({**preset})
    preset.pop("_id", None)
    return preset


def _url_to_storage_path(u: str) -> Optional[str]:
    """Convert /api/images/<path> back to <path>."""
    if not u:
        return None
    marker = "/api/images/"
    idx = u.find(marker)
    if idx == -1:
        # maybe it's already a storage path
        return u if u.startswith(APP_NAME + "/") else None
    return u[idx + len(marker):]


async def list_style_presets() -> list[dict]:
    docs = await style_presets.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


async def get_style_preset(preset_id: str) -> Optional[dict]:
    return await style_presets.find_one({"id": preset_id}, {"_id": 0})


async def delete_style_preset(preset_id: str) -> bool:
    r = await style_presets.delete_one({"id": preset_id})
    return r.deleted_count > 0


# ----------------- reference analysis -----------------
async def analyze_reference_from_url(url: str) -> str:
    path = _url_to_storage_path(url)
    if not path:
        raise ValueError("invalid reference url")
    b64_list = await _paths_to_base64([path])
    if not b64_list:
        raise ValueError("failed to load reference image")
    key = await get_effective_api_key()
    return await gen.analyze_reference_style(b64_list[0], api_key_override=key)


# ----------------- single generation -----------------
async def perform_generate(req_dict: dict) -> list[dict]:
    """Generate images for a single prompt. Returns list of generation records (public shape)."""
    prompt = req_dict["prompt"]
    model = req_dict.get("model") or gen.MODEL_NANO_BANANA
    negative_prompt = req_dict.get("negative_prompt")
    aspect_ratio = req_dict.get("aspect_ratio") or "1:1"
    count = int(req_dict.get("count") or 1)
    style_preset_id = req_dict.get("style_preset_id")
    extra_style_suffix = req_dict.get("style_suffix")
    strength = req_dict.get("reference_strength") or "balanced"
    request_ref_urls = req_dict.get("reference_image_urls") or []

    # Build style + collect reference paths
    style_suffix, preset_ref_paths = await _resolve_style_suffix(
        style_preset_id=style_preset_id,
        extra_style_suffix=extra_style_suffix,
        strength=strength,
    )

    request_ref_paths = [p for p in (_url_to_storage_path(u) for u in request_ref_urls) if p]
    all_ref_paths = list(request_ref_paths) + list(preset_ref_paths or [])
    ref_b64 = await _paths_to_base64(all_ref_paths) if all_ref_paths else None

    api_key = await get_effective_api_key()
    image_bytes_list = await gen.generate_batch(
        prompt=prompt,
        count=count,
        model=model,
        negative_prompt=negative_prompt,
        aspect_ratio=aspect_ratio,
        style_suffix=style_suffix,
        reference_images_b64=ref_b64,
        api_key_override=api_key,
    )

    if not image_bytes_list:
        raise RuntimeError("Model returned no images")

    records: list[dict] = []
    for img_bytes in image_bytes_list:
        storage_path = await store_image_bytes(img_bytes, kind="generations")
        rec = {
            "id": str(uuid.uuid4()),
            "storage_path": storage_path,
            "image_url": public_image_url(storage_path),
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model": model,
            "aspect_ratio": aspect_ratio,
            "style_preset_id": style_preset_id,
            "style_suffix": style_suffix,
            "reference_image_urls": [public_image_url(p) for p in all_ref_paths],
            "reference_strength": strength,
            "created_at": _now(),
            "is_deleted": False,
            "batch_id": None,
        }
        await generations.insert_one({**rec})
        rec.pop("_id", None)
        records.append(rec)
    return records


# ----------------- bulk / batch -----------------
async def start_batch(req: dict) -> dict:
    prompts = [p.strip() for p in (req.get("prompts") or []) if p and p.strip()]
    if not prompts:
        raise ValueError("no prompts provided")
    batch_id = str(uuid.uuid4())
    doc = {
        "id": batch_id,
        "created_at": _now(),
        "status": "running",
        "model": req.get("model") or gen.MODEL_NANO_BANANA,
        "negative_prompt": req.get("negative_prompt"),
        "aspect_ratio": req.get("aspect_ratio") or "1:1",
        "count_per_prompt": int(req.get("count_per_prompt") or 1),
        "style_preset_id": req.get("style_preset_id"),
        "style_suffix": req.get("style_suffix"),
        "reference_image_urls": req.get("reference_image_urls") or [],
        "reference_strength": req.get("reference_strength") or "balanced",
        "items": [
            {
                "index": i,
                "prompt": p,
                "status": "pending",
                "attempts": 0,
                "image_urls": [],
                "generation_ids": [],
                "error": None,
            }
            for i, p in enumerate(prompts)
        ],
    }
    await batches.insert_one({**doc})
    # kick off worker in background
    asyncio.create_task(_run_batch(batch_id))
    doc.pop("_id", None)
    return doc


async def _update_item(batch_id: str, index: int, updates: dict) -> None:
    set_doc = {f"items.{index}.{k}": v for k, v in updates.items()}
    await batches.update_one({"id": batch_id}, {"$set": set_doc})


async def _run_batch(batch_id: str) -> None:
    doc = await batches.find_one({"id": batch_id})
    if not doc:
        return
    sem = asyncio.Semaphore(BULK_CONCURRENCY)

    async def process(item: dict) -> None:
        idx = item["index"]
        async with sem:
            for attempt in range(1, PROMPT_MAX_RETRIES + 2):
                await _update_item(batch_id, idx, {"status": "generating", "attempts": attempt})
                try:
                    records = await perform_generate({
                        "prompt": item["prompt"],
                        "model": doc["model"],
                        "negative_prompt": doc.get("negative_prompt"),
                        "aspect_ratio": doc.get("aspect_ratio"),
                        "count": doc.get("count_per_prompt", 1),
                        "style_preset_id": doc.get("style_preset_id"),
                        "style_suffix": doc.get("style_suffix"),
                        "reference_image_urls": doc.get("reference_image_urls"),
                        "reference_strength": doc.get("reference_strength"),
                    })
                    # tag with batch_id
                    ids = [r["id"] for r in records]
                    urls = [r["image_url"] for r in records]
                    if ids:
                        await generations.update_many({"id": {"$in": ids}}, {"$set": {"batch_id": batch_id}})
                    await _update_item(batch_id, idx, {
                        "status": "done",
                        "image_urls": urls,
                        "generation_ids": ids,
                        "error": None,
                    })
                    return
                except Exception as e:
                    logger.exception("batch %s item %d attempt %d failed: %s", batch_id, idx, attempt, e)
                    await _update_item(batch_id, idx, {"error": str(e)[:400]})
                    if attempt > PROMPT_MAX_RETRIES:
                        await _update_item(batch_id, idx, {"status": "failed"})
                        return
                    await asyncio.sleep(1.0 * attempt)

    await asyncio.gather(*[process(it) for it in doc["items"]], return_exceptions=True)
    # mark completed
    fresh = await batches.find_one({"id": batch_id})
    if fresh:
        any_running = any(it["status"] in ("pending", "generating") for it in fresh["items"])
        await batches.update_one({"id": batch_id}, {"$set": {"status": "completed" if not any_running else "running", "completed_at": _now()}})


async def get_batch(batch_id: str) -> Optional[dict]:
    return await batches.find_one({"id": batch_id}, {"_id": 0})


async def list_batches(limit: int = 50, offset: int = 0) -> list[dict]:
    return await batches.find({}, {"_id": 0}).sort("created_at", -1).skip(offset).limit(limit).to_list(limit)


async def build_batch_zip(batch_id: str) -> Optional[bytes]:
    doc = await batches.find_one({"id": batch_id})
    if not doc:
        return None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in doc["items"]:
            for i, gen_id in enumerate(item.get("generation_ids") or []):
                grec = await generations.find_one({"id": gen_id})
                if not grec:
                    continue
                try:
                    data, ct = await fetch_image_bytes(grec["storage_path"])
                except Exception as e:
                    logger.warning("skip %s: %s", gen_id, e)
                    continue
                ext = "png" if "png" in ct else "jpg"
                safe_prompt = "".join(c if c.isalnum() or c in "-_ " else "_" for c in item["prompt"])[:40].strip() or "prompt"
                fname = f"{item['index']+1:03d}_{safe_prompt}_{i+1}.{ext}"
                zf.writestr(fname, data)
        # include a manifest
        manifest_lines = [f"Batch {batch_id}", f"created_at: {doc.get('created_at')}", ""]
        for it in doc["items"]:
            manifest_lines.append(f"[{it['index']+1}] status={it['status']} prompt={it['prompt']}")
        zf.writestr("manifest.txt", "\n".join(manifest_lines))
    return buf.getvalue()


# ----------------- gallery -----------------
async def list_gallery(limit: int = 60, offset: int = 0) -> list[dict]:
    docs = await generations.find({"is_deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    return docs


async def delete_generation(gen_id: str) -> bool:
    r = await generations.update_one({"id": gen_id}, {"$set": {"is_deleted": True}})
    return r.matched_count > 0


async def get_generation(gen_id: str) -> Optional[dict]:
    return await generations.find_one({"id": gen_id, "is_deleted": {"$ne": True}}, {"_id": 0})


# ----------------- reference image upload -----------------
async def store_uploaded_reference(data: bytes, content_type: str) -> dict:
    path = await store_image_bytes(data, kind="references", content_type=content_type)
    return {"storage_path": path, "image_url": public_image_url(path)}
