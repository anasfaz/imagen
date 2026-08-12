"""Google Gemini image generation using emergentintegrations."""
import asyncio
import base64
import os
import uuid
import logging
from typing import Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

logger = logging.getLogger(__name__)

# Model identifiers used by the API
MODEL_NANO_BANANA = "gemini-3.1-flash-image-preview"      # Fast, cheap — default for bulk
MODEL_NANO_BANANA_PRO = "gemini-3-pro-image-preview"      # High quality — for premium single generations

MODELS_META = [
    {
        "id": MODEL_NANO_BANANA,
        "name": "Nano Banana (Flash)",
        "description": "Fast, cost-effective. Best for bulk generation and quick iteration.",
        "speed": "fast",
        "quality": "good",
    },
    {
        "id": MODEL_NANO_BANANA_PRO,
        "name": "Nano Banana Pro",
        "description": "Highest quality. Best for photorealistic single generations and hero shots.",
        "speed": "slower",
        "quality": "premium",
    },
]

ASPECT_RATIO_HINTS = {
    "1:1": "square 1:1 aspect ratio",
    "16:9": "widescreen 16:9 landscape aspect ratio",
    "9:16": "vertical 9:16 portrait aspect ratio (mobile / social)",
    "4:3": "4:3 landscape aspect ratio",
    "3:4": "3:4 portrait aspect ratio",
}


def _api_key(override: Optional[str] = None) -> str:
    return (override or os.environ.get("EMERGENT_LLM_KEY") or "").strip()


def _build_prompt(prompt: str, negative_prompt: Optional[str], aspect_ratio: Optional[str], style_suffix: Optional[str]) -> str:
    parts = [prompt.strip()]
    if style_suffix:
        parts.append(style_suffix.strip())
    if aspect_ratio and aspect_ratio in ASPECT_RATIO_HINTS:
        parts.append(f"Framing: {ASPECT_RATIO_HINTS[aspect_ratio]}.")
    if negative_prompt:
        parts.append(f"Avoid: {negative_prompt.strip()}.")
    return " \n".join(parts)


async def generate_image(
    *,
    prompt: str,
    model: str = MODEL_NANO_BANANA,
    negative_prompt: Optional[str] = None,
    aspect_ratio: Optional[str] = "1:1",
    style_suffix: Optional[str] = None,
    reference_images_b64: Optional[list[str]] = None,
    api_key_override: Optional[str] = None,
) -> list[bytes]:
    """Generate one or more images. Returns list of raw image bytes."""
    api_key = _api_key(api_key_override)
    if not api_key:
        raise RuntimeError("No API key configured")

    session_id = f"imgen-{uuid.uuid4()}"
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message="You are an expert AI image generator.")
    chat.with_model("gemini", model).with_params(modalities=["image", "text"])

    full_prompt = _build_prompt(prompt, negative_prompt, aspect_ratio, style_suffix)

    file_contents = None
    if reference_images_b64:
        file_contents = [ImageContent(b64) for b64 in reference_images_b64]

    msg = UserMessage(text=full_prompt, file_contents=file_contents) if file_contents else UserMessage(text=full_prompt)

    text, images = await chat.send_message_multimodal_response(msg)
    logger.info("gen model=%s -> %d images (text_len=%d)", model, len(images or []), len(text or ""))

    out: list[bytes] = []
    for img in images or []:
        try:
            out.append(base64.b64decode(img["data"]))
        except Exception as e:
            logger.warning("failed to decode image: %s", e)
    return out


async def generate_batch(
    *,
    prompt: str,
    count: int,
    model: str,
    negative_prompt: Optional[str],
    aspect_ratio: Optional[str],
    style_suffix: Optional[str],
    reference_images_b64: Optional[list[str]],
    api_key_override: Optional[str],
) -> list[bytes]:
    """Generate `count` images concurrently for a single prompt."""
    count = max(1, min(4, count))
    tasks = [
        generate_image(
            prompt=prompt,
            model=model,
            negative_prompt=negative_prompt,
            aspect_ratio=aspect_ratio,
            style_suffix=style_suffix,
            reference_images_b64=reference_images_b64,
            api_key_override=api_key_override,
        )
        for _ in range(count)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    imgs: list[bytes] = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning("one image in batch failed: %s", r)
            continue
        imgs.extend(r)
    return imgs


async def analyze_reference_style(
    reference_image_b64: str,
    api_key_override: Optional[str] = None,
) -> str:
    """Use Gemini vision to extract a rich style description from a reference image."""
    api_key = _api_key(api_key_override)
    if not api_key:
        raise RuntimeError("No API key configured")
    session_id = f"style-{uuid.uuid4()}"
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=(
            "You are a professional art director. Given a single reference image, produce a concise "
            "style description (3-5 short sentences, ~80-140 words) covering: lighting, colour palette, "
            "mood/atmosphere, camera or lens characteristics, composition, and any distinct rendering "
            "style (photographic, illustration, 3D, etc.). Do NOT describe the subject content — only "
            "the visual style. Reply with plain prose only, no headings, no bullet lists."
        ),
    )
    chat.with_model("gemini", "gemini-3-flash").with_params(modalities=["text"])
    msg = UserMessage(
        text="Analyse the visual style of this reference image.",
        file_contents=[ImageContent(reference_image_b64)],
    )
    try:
        resp = await chat.send_message(msg)
    except Exception:
        # fall back to nano banana pro if gemini-3-flash isn't available
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id + "-fb",
            system_message="You are an art director describing visual style.",
        )
        chat.with_model("gemini", MODEL_NANO_BANANA_PRO).with_params(modalities=["text"])
        resp = await chat.send_message(msg)
    return (resp or "").strip()
