import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND}/api`;
export const BACKEND_URL = BACKEND;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 180000,
});

// Convert a backend-relative /api/images/... URL to an absolute URL the browser can load.
export function absoluteUrl(u) {
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `${BACKEND}${u.startsWith("/") ? "" : "/"}${u}`;
}

export async function listModels() {
  const { data } = await api.get("/models");
  return data.models;
}

export async function generateImages(payload) {
  const { data } = await api.post("/generate", payload);
  return data.images;
}

export async function uploadReference(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await api.post("/references/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data; // {storage_path, image_url}
}

export async function analyzeReference(reference_image_url) {
  const { data } = await api.post("/references/analyze", { reference_image_url });
  return data.style_description;
}

export async function listPresets(collectionId) {
  const params = collectionId ? { collection_id: collectionId } : {};
  const { data } = await api.get("/style-presets", { params });
  return data.presets;
}

export async function createPreset(payload) {
  const { data } = await api.post("/style-presets", payload);
  return data;
}

export async function deletePreset(id) {
  const { data } = await api.delete(`/style-presets/${id}`);
  return data;
}

export async function analyzeReferencesMulti(reference_image_urls) {
  const { data } = await api.post("/references/analyze-multi", { reference_image_urls });
  return data.style_description;
}

export async function remixPrompt(genId, n = 10) {
  const { data } = await api.post(`/gallery/${genId}/remix`, { n });
  return data.prompts;
}

export async function getPublicShare(genId) {
  const { data } = await api.get(`/share/${genId}`);
  return data;
}

export async function listCollections() {
  const { data } = await api.get("/collections");
  return data.collections;
}

export async function createCollection(name, description) {
  const { data } = await api.post("/collections", { name, description });
  return data;
}

export async function deleteCollection(id) {
  const { data } = await api.delete(`/collections/${id}`);
  return data;
}

export async function assignPresetToCollection(collectionId, presetId) {
  const { data } = await api.post(`/collections/${collectionId}/presets/${presetId}`);
  return data;
}

export async function removePresetFromCollection(collectionId, presetId) {
  const { data } = await api.delete(`/collections/${collectionId}/presets/${presetId}`);
  return data;
}

export async function listGallery(limit = 60, offset = 0) {
  const { data } = await api.get("/gallery", { params: { limit, offset } });
  return data.generations;
}

export async function deleteGeneration(id) {
  const { data } = await api.delete(`/gallery/${id}`);
  return data;
}

export async function startBulk(payload) {
  const { data } = await api.post("/bulk", payload);
  return data;
}

export async function getBatch(batchId) {
  const { data } = await api.get(`/bulk/${batchId}`);
  return data;
}

export async function listBatches() {
  const { data } = await api.get("/bulk");
  return data.batches;
}

export function batchZipUrl(batchId) {
  return `${API_BASE}/bulk/${batchId}/zip`;
}

export async function getSettings() {
  const { data } = await api.get("/settings");
  // Attach the absolute Claude connect URL for convenience.
  if (data.mcp_connect_path) {
    data.mcp_connect_url = `${BACKEND_URL}${data.mcp_connect_path}`;
  }
  return data;
}

export async function saveGeminiKey(gemini_api_key) {
  const { data } = await api.post("/settings", { gemini_api_key });
  return data;
}

export async function regenerateMcpToken() {
  const { data } = await api.post("/settings/mcp/regenerate");
  return data.mcp_token;
}
