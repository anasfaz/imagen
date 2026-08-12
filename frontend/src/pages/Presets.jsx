import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Palette } from "lucide-react";
import { listPresets, createPreset, deletePreset, uploadReference, analyzeReference, absoluteUrl } from "@/lib/api";
import { TID } from "@/constants/testIds";

const STRENGTHS = ["subtle", "balanced", "strong"];

export default function Presets() {
  const [presets, setPresets] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("balanced");
  const [uploaded, setUploaded] = useState(null); // {storage_path, image_url}
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listPresets().then(setPresets);
  }, []);

  const onFile = async (file) => {
    if (!file) return;
    try {
      const res = await uploadReference(file);
      setUploaded(res);
      setAnalyzing(true);
      try {
        const desc = await analyzeReference(res.image_url);
        setDescription(desc);
      } catch (e) {
        toast.error("Auto-analysis failed — you can still save with a manual description");
      } finally {
        setAnalyzing(false);
      }
    } catch {
      toast.error("Upload failed");
    }
  };

  const reset = () => {
    setName("");
    setUploaded(null);
    setDescription("");
    setStrength("balanced");
    setOpen(false);
  };

  const save = async () => {
    if (!name.trim() || !uploaded) {
      toast.error("Name and a reference image are required");
      return;
    }
    setSaving(true);
    try {
      const preset = await createPreset({
        name: name.trim(),
        reference_image_urls: [uploaded.image_url],
        style_description: description || null,
        reference_strength: strength,
      });
      setPresets([preset, ...presets]);
      toast.success(`Saved "${preset.name}"`);
      reset();
    } catch (e) {
      toast.error("Save failed: " + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const del = async (p) => {
    if (!window.confirm(`Delete style "${p.name}"?`)) return;
    try {
      await deletePreset(p.id);
      setPresets((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div data-testid={TID.presets.root} className="min-h-full px-6 md:px-10 py-10 max-w-[1400px] mx-auto">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">Style presets</div>
          <h1 className="mt-1 text-4xl sm:text-5xl font-heading font-semibold tracking-tight">
            Save a reference. Reuse forever.
          </h1>
          <p className="mt-2 text-zinc-400 max-w-2xl">
            Turn one reference image into a reusable style. Combine it with bulk mode to keep every
            render on-brand at scale.
          </p>
        </div>
        <button
          data-testid={TID.presets.createBtn}
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New style preset
        </button>
      </header>

      {presets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 h-[420px] flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
            <Palette className="w-5 h-5 text-zinc-400" />
          </div>
          <div className="font-heading text-lg text-zinc-200">No saved styles yet</div>
          <div className="text-zinc-500 text-sm mt-1 max-w-md">
            Upload a reference image, let Gemini extract its visual DNA, and reuse it across every
            future render.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {presets.map((p) => (
            <article
              key={p.id}
              data-testid={TID.presets.card(p.id)}
              className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/50 group"
            >
              <div className="aspect-video overflow-hidden">
                <img
                  src={absoluteUrl(p.thumbnail_url)}
                  alt={p.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-heading text-lg tracking-tight">{p.name}</div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mt-0.5">
                      {p.reference_strength} · id {p.id.slice(0, 6)}
                    </div>
                  </div>
                  <button
                    data-testid={TID.presets.deleteBtn(p.id)}
                    onClick={() => del(p)}
                    className="w-8 h-8 rounded-full grid place-items-center text-zinc-400 hover:text-red-400 hover:bg-red-950/50 border border-zinc-800 hover:border-red-900 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">
                  {p.style_description}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 backdrop-blur-sm bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">New preset</div>
              <div className="font-heading text-xl tracking-tight mt-1">Create a reusable style</div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400 block">Name</label>
              <input
                data-testid={TID.presets.dialogName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Neon Noir"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400 block">Reference image</label>
              {uploaded ? (
                <img src={absoluteUrl(uploaded.image_url)} alt="ref" className="w-full h-40 object-cover rounded-lg border border-zinc-800" />
              ) : (
                <label className="flex flex-col items-center justify-center h-40 border border-dashed border-zinc-700 rounded-lg bg-zinc-950 cursor-pointer hover:bg-zinc-900 transition-colors">
                  <span className="text-sm text-zinc-300">Click to upload</span>
                  <span className="text-[11px] text-zinc-500 mt-1 font-mono">JPG · PNG · WebP</span>
                  <input
                    data-testid={TID.presets.dialogUpload}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>

            {uploaded && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-400 block">Style description {analyzing && <span className="text-zinc-500">(analysing…)</span>}</label>
                  <button
                    data-testid={TID.presets.dialogAnalyzeBtn}
                    onClick={async () => {
                      setAnalyzing(true);
                      try {
                        const desc = await analyzeReference(uploaded.image_url);
                        setDescription(desc);
                      } catch { toast.error("Re-analyse failed"); }
                      finally { setAnalyzing(false); }
                    }}
                    className="text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors"
                  >
                    re-analyse
                  </button>
                </div>
                <textarea
                  data-testid={TID.presets.dialogDescription}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm font-mono outline-none focus:border-zinc-500 transition-colors"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-zinc-400 block">Reference strength</label>
              <div data-testid={TID.presets.dialogStrength} className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-950 border border-zinc-800 p-1">
                {STRENGTHS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStrength(s)}
                    className={[
                      "text-xs py-1.5 rounded capitalize transition-colors",
                      strength === s ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid={TID.presets.dialogSaveBtn}
                onClick={save}
                disabled={saving || !name.trim() || !uploaded}
                className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving…" : "Save preset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
