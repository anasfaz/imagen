# Imagen Studio — PRD

## Original problem statement
Build a Higgsfield-style AI image generation web app powered by Google's Gemini
image models. Must support text-to-image, image-to-image / reference generation,
BULK batch generation, style presets, gallery, and a settings screen. Additional
requirements from user:
- Reference-style generation as the primary workflow (multi-ref, strength slider,
  auto style description via Gemini vision, save as reusable named presets,
  combine with bulk mode).
- Expose a remote MCP server so the app can be added as a custom connector in
  Claude, with token auth and 6 named tools.

## User choices (Feb 2026)
- Models: both Nano Banana (`gemini-3.1-flash-image-preview`) as default AND
  Nano Banana Pro (`gemini-3-pro-image-preview`) with selector.
- API key: Emergent universal `EMERGENT_LLM_KEY`, overridable in Settings.
- Storage: Emergent object storage (metadata + URLs in MongoDB).
- Design: dark creative studio (Midjourney/Runway/Higgsfield style).
- Priority: BULK/batch generation is the #1 feature.

## Architecture
- **Backend**: FastAPI (0.141) + Motor (MongoDB) + `emergentintegrations` (Gemini)
  + Emergent Object Storage + `mcp==2.0.0` streamable HTTP server.
- **Frontend**: React 19 + react-router + Tailwind + shadcn/ui + framer-motion
  + sonner + lucide.
- **MCP mount path**: `/api/mcp` (routed by ingress via `/api/*`).
- **Fonts**: Outfit (heading), Manrope (body), JetBrains Mono (code/prompt).

### Backend files
- `server.py` — FastAPI app, `/api` router, mounts MCP at `/api/mcp`.
- `db.py` — Motor client + collections (`generations`, `batches`,
  `style_presets`, `settings`).
- `gen.py` — Gemini image generation + reference-style analysis via
  `emergentintegrations`.
- `storage.py` — Emergent Object Storage wrapper (init/put/get).
- `service.py` — business logic (generate, bulk with concurrency+retry, ZIP,
  style presets, settings, MCP token).
- `mcp_app.py` — MCPServer with 6 tools + Bearer/X-API-Key auth middleware.
- `models.py` — Pydantic request models.

### Frontend routes
- `/studio` — reference upload, style analysis, strength slider, built-in
  preset grid, saved presets chips, results view, floating prompt bar.
- `/bulk` — prompts textarea + CSV upload, settings, queue view, ZIP download.
- `/presets` — CRUD for saved reference-based style presets.
- `/gallery` — masonry gallery, lightbox with download / copy prompt / delete /
  regenerate.
- `/settings` — Gemini key override + MCP endpoint URL, auth token, copy
  buttons, regen, Claude connector instructions.

## Implemented (Feb 12 2026)
- Full backend with all endpoints working end-to-end.
- Image generation verified against Gemini 2.5 Flash Image.
- Storage upload / serving verified.
- MCP endpoint verified: initialize → tools/list (all 6 tools) → tools/call
  works over streamable HTTP with Bearer / X-API-Key auth.
- Complete frontend UI matching dark studio design guidelines.

## Backlog / next
- P1: Multi-reference vision analysis (currently only first ref image is
  analysed; user might want a combined style description across N images).
- P1: Regenerate-with-same-settings from gallery lightbox (currently just
  copies prompt/aspect back to Studio via query string; wire actual params).
- P2: Prompt history + copy from previous generation.
- P2: Public share links for individual generations.
- P2: Cost / usage counter per model.

## Credentials
- Emergent universal LLM key lives in `backend/.env` as `EMERGENT_LLM_KEY`.
- MCP token: auto-created on startup, viewable in Settings, rotatable.
