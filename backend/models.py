"""Pydantic models for the AI image studio."""
from typing import Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime, timezone
import uuid


AspectRatio = Literal["1:1", "16:9", "9:16", "4:3", "3:4"]
BatchItemStatus = Literal["pending", "generating", "done", "failed"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


class GenerateRequest(BaseModel):
    prompt: str
    model: str = "gemini-3.1-flash-image-preview"
    negative_prompt: Optional[str] = None
    aspect_ratio: AspectRatio = "1:1"
    count: int = 1
    style_preset_id: Optional[str] = None
    style_suffix: Optional[str] = None
    reference_image_urls: Optional[list[str]] = None
    reference_strength: Optional[Literal["subtle", "balanced", "strong"]] = "balanced"


class BulkGenerateRequest(BaseModel):
    prompts: list[str]
    model: str = "gemini-3.1-flash-image-preview"
    negative_prompt: Optional[str] = None
    aspect_ratio: AspectRatio = "1:1"
    count_per_prompt: int = 1
    style_preset_id: Optional[str] = None
    style_suffix: Optional[str] = None
    reference_image_urls: Optional[list[str]] = None
    reference_strength: Optional[Literal["subtle", "balanced", "strong"]] = "balanced"


class CreateStylePresetRequest(BaseModel):
    name: str
    reference_image_urls: list[str]
    style_description: Optional[str] = None  # optional pre-generated description
    reference_strength: Optional[Literal["subtle", "balanced", "strong"]] = "balanced"
    collection_id: Optional[str] = None


class UpdateStylePresetRequest(BaseModel):
    name: Optional[str] = None
    style_description: Optional[str] = None
    reference_strength: Optional[Literal["subtle", "balanced", "strong"]] = None
    collection_id: Optional[str] = None


class AnalyzeReferenceRequest(BaseModel):
    reference_image_url: str


class AnalyzeMultipleReferencesRequest(BaseModel):
    reference_image_urls: list[str]


class RemixRequest(BaseModel):
    n: int = 10


class CreateCollectionRequest(BaseModel):
    name: str
    description: Optional[str] = None


class SettingsUpdateRequest(BaseModel):
    gemini_api_key: Optional[str] = None
