import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Palette, FolderPlus, Users, X as XIcon, Layers as LayersIcon } from "lucide-react";
import {
  listPresets,
  createPreset,
  deletePreset,
  uploadReference,
  analyzeReference,
  analyzeReferencesMulti,
  listCollections,
  createCollection,
  deleteCollection,
  assignPresetToCollection,
  removePresetFromCollection,
  absoluteUrl,
} from "@/lib/api";
import { TID } from "@/constants/testIds";

const STRENGTHS = ["subtle", "balanced", "strong"];

export default function Presets() {
  const [presets, setPresets] = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("__all__");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("balanced");
  const [uploaded, setUploaded] = useState([]); // list of {storage_path, image_url}
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const [colDialogOpen, setColDialogOpen] = useState(false);
  const [colName, setColName] = useState("");

  useEffect(() => {
    listPresets().then(setPresets);
    listCollections().then(setCollections);
  }, []);

  const onFile = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    if (uploaded.length + files.length > 4) {
      toast.error("Max 4 references per preset");
      return;
    }
    try {
      const uploads = [];
      for (const f of files) {
        const res = await uploadReference(f);
        uploads.push(res);
      }
      const newList = [...uploaded, ...uploads];
      setUploaded(newList);

      setAnalyzing(true);
      try {
        const urls = newList.map((u) => u.image_url);
        const desc = urls.length > 1
          ? await analyzeReferencesMulti(urls)
          : await analyzeReference(urls[0]);
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
    setUploaded([]);
    setDescription("");
    setStrength("balanced");
    setCollectionId("");
    setOpen(false);
  };

  const save = async () => {
    if (!name.trim() || !uploaded.length) {
      toast.error("Name and at least one reference image are required");
      return;
    }
    setSaving(true);
    try {
      const preset = await createPreset({
        name: name.trim(),
        reference_image_urls: uploaded.map((u) => u.image_url),
        style_description: description || null,
        reference_strength: strength,
        collection_id: collectionId || null,
      });
      setPresets([preset, ...presets]);
      // Refresh preset counts on collections
      listCollections().then(setCollections);
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
      listCollections().then(setCollections);
    } catch {
      toast.error("Delete failed");
    }
  };

  const createCol = async () => {
    if (!colName.trim()) return;
    try {
      const c = await createCollection(colName.trim());
      setCollections([{ ...c, preset_count: 0 }, ...collections]);
      setColName("");
      setColDialogOpen(false);
      toast.success(`Collection "${c.name}" created`);
    } catch (e) {
      toast.error("Create failed");
    }
  };

  const delCol = async (c) => {
    if (!window.confirm(`Delete collection "${c.name}"? Presets inside will be uncategorized (not deleted).`)) return;
    try {
      await deleteCollection(c.id);
      setCollections((prev) => prev.filter((x) => x.id !== c.id));
      if (selectedCollection === c.id) setSelectedCollection("__all__");
      // refresh presets to clear collection_id refs
      listPresets().then(setPresets);
    } catch {
      toast.error("Delete failed");
    }
  };

  const changePresetCollection = async (preset, newColId) => {
    try {
      if (newColId) {
        await assignPresetToCollection(newColId, preset.id);
      } else if (preset.collection_id) {
        await removePresetFromCollection(preset.collection_id, preset.id);
      }
      const [ps, cs] = await Promise.all([listPresets(), listCollections()]);
      setPresets(ps);
      setCollections(cs);
      toast.success("Moved");
    } catch {
      toast.error("Move failed");
    }
  };

  const filteredPresets = presets.filter((p) => {
    if (selectedCollection === "__all__") return true;
    if (selectedCollection === "__uncategorized__") return !p.collection_id;
    return p.collection_id === selectedCollection;
  });

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
        <div className="flex items-center gap-2">
          <button
            data-testid={TID.collections.createBtn}
            onClick={() => setColDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-800 hover:border-zinc-600 text-zinc-200 hover:text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <FolderPlus className="w-4 h-4" /> New collection
          </button>
          <button
            data-testid={TID.presets.createBtn}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New style preset
          </button>
        </div>
      </header>

      {/* Collections filter row */}
      <section data-testid={TID.collections.section} className="mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <CollectionChip
            active={selectedCollection === "__all__"}
            onClick={() => setSelectedCollection("__all__")}
            label="All"
            count={presets.length}
          />
          <CollectionChip
            active={selectedCollection === "__uncategorized__"}
            onClick={() => setSelectedCollection("__uncategorized__")}
            label="Uncategorized"
            count={presets.filter((p) => !p.collection_id).length}
          />
          {collections.map((c) => (
            <CollectionChip
              key={c.id}
              testId={TID.collections.chip(c.id)}
              active={selectedCollection === c.id}
              onClick={() => setSelectedCollection(c.id)}
              label={c.name}
              count={c.preset_count}
              onDelete={() => delCol(c)}
              deleteTestId={TID.collections.deleteBtn(c.id)}
            />
          ))}
          {collections.length === 0 && (
            <span className="text-[11px] text-zinc-500 font-mono flex items-center gap-1.5">
              <Users className="w-3 h-3" />
              Create collections to organise styles for your team.
            </span>
          )}
        </div>
      </section>

      {filteredPresets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 h-[420px] flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
            <Palette className="w-5 h-5 text-zinc-400" />
          </div>
          <div className="font-heading text-lg text-zinc-200">
            {presets.length === 0 ? "No saved styles yet" : "Nothing in this collection"}
          </div>
          <div className="text-zinc-500 text-sm mt-1 max-w-md">
            Upload one or more reference images. Multiple refs get fused into a single style DNA.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredPresets.map((p) => (
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
                      {p.reference_image_paths?.length > 1 && (
                        <span className="ml-1 text-zinc-300">· {p.reference_image_paths.length} refs</span>
                      )}
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
                <div className="pt-1 flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Collection
                  </span>
                  <select
                    data-testid={TID.collections.assignSelect(p.id)}
                    value={p.collection_id || ""}
                    onChange={(e) => changePresetCollection(p, e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
                  >
                    <option value="">Uncategorized</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
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
              <label className="text-xs text-zinc-400 block">
                Reference image{uploaded.length > 1 ? "s" : ""}{" "}
                <span className="text-zinc-600">{uploaded.length}/4</span>
              </label>
              {uploaded.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {uploaded.map((u, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-zinc-800 group">
                      <img src={absoluteUrl(u.image_url)} alt="ref" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setUploaded(uploaded.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-zinc-950/80 border border-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {uploaded.length < 4 && (
                <label className="flex flex-col items-center justify-center h-24 border border-dashed border-zinc-700 rounded-lg bg-zinc-950 cursor-pointer hover:bg-zinc-900 transition-colors">
                  <span className="text-sm text-zinc-300">
                    {uploaded.length === 0 ? "Click to upload — pick multiple to fuse" : "+ add another reference"}
                  </span>
                  <span className="text-[11px] text-zinc-500 mt-1 font-mono">
                    JPG · PNG · WebP · multi-select supported
                  </span>
                  <input
                    data-testid={TID.presets.dialogUpload}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onFile(e.target.files)}
                  />
                </label>
              )}
            </div>

            {uploaded.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-400 block">
                    {uploaded.length > 1 ? "Fused style DNA" : "Style description"}
                    {analyzing && <span className="text-zinc-500"> (analysing…)</span>}
                  </label>
                  <button
                    data-testid={TID.presets.dialogAnalyzeBtn}
                    onClick={async () => {
                      setAnalyzing(true);
                      try {
                        const urls = uploaded.map((u) => u.image_url);
                        const desc = urls.length > 1
                          ? await analyzeReferencesMulti(urls)
                          : await analyzeReference(urls[0]);
                        setDescription(desc);
                      } catch { toast.error("Re-analyse failed"); }
                      finally { setAnalyzing(false); }
                    }}
                    className="text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors"
                  >
                    {uploaded.length > 1 ? "re-fuse" : "re-analyse"}
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

            {collections.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 block">Add to collection (optional)</label>
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500 transition-colors"
                >
                  <option value="">Uncategorized</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

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
                disabled={saving || !name.trim() || !uploaded.length}
                className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving…" : "Save preset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {colDialogOpen && (
        <div className="fixed inset-0 z-50 backdrop-blur-sm bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">New collection</div>
              <div className="font-heading text-xl tracking-tight mt-1 flex items-center gap-2">
                <LayersIcon className="w-4 h-4" /> Group styles for your team
              </div>
            </div>
            <input
              data-testid={TID.collections.dialogName}
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              placeholder="e.g. Acme SS26 Campaign"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500 transition-colors"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setColDialogOpen(false); setColName(""); }}
                className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid={TID.collections.dialogSave}
                onClick={createCol}
                disabled={!colName.trim()}
                className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectionChip({ label, count, active, onClick, onDelete, testId, deleteTestId }) {
  return (
    <div
      data-testid={testId}
      className={[
        "group inline-flex items-center gap-1.5 rounded-full pl-3 pr-2 py-1 border transition-colors",
        active
          ? "bg-zinc-100 text-zinc-900 border-zinc-100"
          : "bg-zinc-900 text-zinc-200 border-zinc-800 hover:border-zinc-500",
      ].join(" ")}
    >
      <button onClick={onClick} className="text-xs font-medium">
        {label}
      </button>
      <span className={active ? "text-[10px] font-mono text-zinc-500" : "text-[10px] font-mono text-zinc-500"}>
        {count}
      </span>
      {onDelete && (
        <button
          data-testid={deleteTestId}
          onClick={onDelete}
          className={[
            "w-5 h-5 rounded-full grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity",
            active ? "text-zinc-500 hover:text-red-600 hover:bg-zinc-200" : "text-zinc-500 hover:text-red-400 hover:bg-zinc-800",
          ].join(" ")}
        >
          <XIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
