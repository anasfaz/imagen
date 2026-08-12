import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, PlayCircle, Download, Loader2, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import {
  listModels,
  listPresets,
  startBulk,
  getBatch,
  batchZipUrl,
  absoluteUrl,
} from "@/lib/api";
import { TID } from "@/constants/testIds";

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

export default function BulkPage() {
  const [models, setModels] = useState([]);
  const [presets, setPresets] = useState([]);
  const [text, setText] = useState("");
  const [model, setModel] = useState("gemini-3.1-flash-image-preview");
  const [aspect, setAspect] = useState("1:1");
  const [countPer, setCountPer] = useState(1);
  const [presetId, setPresetId] = useState("");
  const [batch, setBatch] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    listModels().then(setModels).catch(() => {});
    listPresets().then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!batch) return;
    if (batch.status !== "running") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const doc = await getBatch(batch.id);
        setBatch(doc);
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [batch?.id, batch?.status]);

  const onCsv = async (file) => {
    if (!file) return;
    const txt = await file.text();
    const lines = txt
      .split(/\r?\n/)
      .map((l) => l.split(",")[0])
      .filter((l) => l.trim().length > 0);
    setText(lines.join("\n"));
    toast.success(`Loaded ${lines.length} prompts from CSV`);
  };

  const onStart = async () => {
    const prompts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!prompts.length) {
      toast.error("Add at least one prompt");
      return;
    }
    setStarting(true);
    try {
      const doc = await startBulk({
        prompts,
        model,
        aspect_ratio: aspect,
        count_per_prompt: countPer,
        style_preset_id: presetId || null,
      });
      setBatch(doc);
      toast.success(`Batch started: ${prompts.length} prompts`);
    } catch (e) {
      toast.error("Failed to start batch: " + (e.response?.data?.detail || e.message));
    } finally {
      setStarting(false);
    }
  };

  const done = batch ? batch.items.filter((i) => i.status === "done").length : 0;
  const failed = batch ? batch.items.filter((i) => i.status === "failed").length : 0;
  const total = batch ? batch.items.length : 0;
  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;

  return (
    <div data-testid={TID.bulk.root} className="min-h-full px-6 md:px-10 py-10 max-w-[1400px] mx-auto">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">Bulk</div>
        <h1 className="mt-1 text-4xl sm:text-5xl font-heading font-semibold tracking-tight">
          Batch generation
        </h1>
        <p className="mt-2 text-zinc-400 max-w-2xl">
          Paste one prompt per line or upload a CSV. Combine with a saved style preset for on-brand
          generations at scale.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8">
        {/* Input side */}
        <section className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-mono uppercase tracking-widest text-zinc-500">
                Prompts ({text.split(/\n+/).filter((s) => s.trim()).length})
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-md px-2.5 py-1.5 transition-colors cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload CSV
                <input
                  data-testid={TID.bulk.csvUpload}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => onCsv(e.target.files?.[0])}
                />
              </label>
            </div>
            <textarea
              data-testid={TID.bulk.promptsTextarea}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              placeholder="One prompt per line…\n\ncinematic portrait of a woman in a Parisian cafe\nproduct shot of a red sneaker on marble\nminimalist mountain landscape at dawn"
              className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-500 transition-colors resize-y"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SelectField
              label="Model"
              testId={TID.bulk.modelSelect}
              value={model}
              onChange={setModel}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
            />
            <SelectField
              label="Aspect"
              testId={TID.bulk.aspectSelect}
              value={aspect}
              onChange={setAspect}
              options={RATIOS.map((r) => ({ value: r, label: r }))}
            />
            <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
                Images per prompt
              </div>
              <input
                data-testid={TID.bulk.countInput}
                type="number"
                min={1}
                max={4}
                value={countPer}
                onChange={(e) => setCountPer(Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full bg-transparent text-sm text-zinc-100 outline-none mt-1 font-mono"
              />
            </div>
            <SelectField
              label="Style preset"
              testId={TID.bulk.presetSelect}
              value={presetId}
              onChange={setPresetId}
              options={[{ value: "", label: "None" }, ...presets.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>

          <button
            data-testid={TID.bulk.startBtn}
            onClick={onStart}
            disabled={starting || !text.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-100 text-zinc-900 hover:bg-white font-medium py-3 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,transform] active:scale-[0.99]"
          >
            <PlayCircle className="w-4 h-4" /> {starting ? "Starting…" : "Start batch"}
          </button>
        </section>

        {/* Queue side */}
        <section className="min-h-[400px]">
          {batch ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 flex flex-col h-[calc(100vh-160px)] sticky top-4">
              <div className="p-4 border-b border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-500 font-mono">
                      Batch {batch.id.slice(0, 8)} · {batch.model}
                    </div>
                    <div className="text-2xl font-heading tracking-tight mt-1">
                      {done}/{total} <span className="text-zinc-500 text-sm">complete</span>
                      {failed > 0 && (
                        <span className="ml-2 text-red-400 text-sm">· {failed} failed</span>
                      )}
                    </div>
                  </div>
                  <a
                    data-testid={TID.bulk.downloadZipBtn}
                    href={batchZipUrl(batch.id)}
                    className={[
                      "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                      done > 0
                        ? "bg-zinc-100 text-zinc-900 hover:bg-white"
                        : "bg-zinc-800 text-zinc-500 pointer-events-none",
                    ].join(" ")}
                  >
                    <Download className="w-4 h-4" /> ZIP
                  </a>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-zinc-100 transition-[width] duration-500"
                    style={{ width: pct + "%" }}
                  />
                </div>
                <div className="text-[11px] font-mono text-zinc-500 mt-1.5">
                  status: {batch.status}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-3 space-y-1.5">
                {batch.items.map((it) => (
                  <BatchItem key={it.index} item={it} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 h-[500px] flex flex-col items-center justify-center text-center px-8">
              <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
                <PlayCircle className="w-5 h-5 text-zinc-400" />
              </div>
              <div className="font-heading text-lg text-zinc-200">No batch running</div>
              <div className="text-zinc-500 text-sm mt-1 max-w-xs">
                Add prompts and press Start — each one runs with sensible concurrency and retries on failure.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BatchItem({ item }) {
  const icon =
    item.status === "done" ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    ) : item.status === "failed" ? (
      <XCircle className="w-4 h-4 text-red-400" />
    ) : item.status === "generating" ? (
      <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
    ) : (
      <Clock className="w-4 h-4 text-zinc-500" />
    );
  return (
    <div
      data-testid={TID.bulk.item(item.index)}
      className={[
        "flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors",
        item.status === "done"
          ? "bg-emerald-950/20 border-emerald-900/40"
          : item.status === "failed"
          ? "bg-red-950/20 border-red-900/40"
          : "bg-zinc-950/50 border-zinc-800",
      ].join(" ")}
    >
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-mono text-zinc-500">#{item.index + 1}</div>
        <div className="text-xs text-zinc-100 truncate">{item.prompt}</div>
        {item.error && <div className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</div>}
      </div>
      {item.image_urls?.length ? (
        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid={TID.bulk.itemStatus(item.index)}
            className="text-[10px] font-mono uppercase text-emerald-400 tracking-widest"
          >
            {item.status}
          </span>
          <div className="flex -space-x-2">
            {item.image_urls.slice(0, 3).map((u, i) => (
              <img
                key={i}
                src={absoluteUrl(u)}
                alt=""
                className="w-8 h-8 rounded-md object-cover border border-zinc-800"
              />
            ))}
          </div>
        </div>
      ) : (
        <span
          data-testid={TID.bulk.itemStatus(item.index)}
          className="text-[10px] font-mono uppercase text-zinc-500 tracking-widest"
        >
          {item.status}
        </span>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options, testId }) {
  return (
    <label className="rounded-lg bg-zinc-900/50 border border-zinc-800 px-3 py-2 block">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">{label}</div>
      <div className="relative">
        <select
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm text-zinc-100 outline-none mt-1 appearance-none pr-4"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-zinc-900">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-0 top-1/2 -translate-y-1/2" />
      </div>
    </label>
  );
}
