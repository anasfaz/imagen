import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Wand2, Save, Info, Sparkles as SparklesIcon } from "lucide-react";

import FloatingPromptBar from "@/components/FloatingPromptBar";
import ReferenceUpload from "@/components/ReferenceUpload";
import StylePresetGrid, { findBuiltInById } from "@/components/StylePresetGrid";
import ImageLightbox from "@/components/ImageLightbox";
import { TID } from "@/constants/testIds";
import {
  listModels,
  generateImages,
  analyzeReference,
  listPresets,
  createPreset,
  absoluteUrl,
} from "@/lib/api";

const STRENGTHS = [
  { key: "subtle", label: "Subtle" },
  { key: "balanced", label: "Balanced" },
  { key: "strong", label: "Strong" },
];

export default function Studio() {
  const navigate = useNavigate();

  const [models, setModels] = useState([]);
  const [savedPresets, setSavedPresets] = useState([]);

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [showNegative, setShowNegative] = useState(false);
  const [aspect, setAspect] = useState("1:1");
  const [count, setCount] = useState(1);
  const [model, setModel] = useState("gemini-3.1-flash-image-preview");

  const [builtInStyleId, setBuiltInStyleId] = useState(null);
  const [savedPresetId, setSavedPresetId] = useState(null);
  const [references, setReferences] = useState([]); // [{storage_path, image_url}]
  const [strength, setStrength] = useState("balanced");
  const [styleDescription, setStyleDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    listModels().then(setModels).catch(() => {});
    listPresets().then(setSavedPresets).catch(() => {});
  }, []);

  const builtIn = useMemo(() => (builtInStyleId ? findBuiltInById(builtInStyleId) : null), [builtInStyleId]);
  const savedPreset = useMemo(
    () => (savedPresetId ? savedPresets.find((p) => p.id === savedPresetId) : null),
    [savedPresetId, savedPresets],
  );

  // Auto-analyze first newly uploaded reference to produce a style description
  useEffect(() => {
    if (!references.length) {
      setStyleDescription("");
      return;
    }
    if (styleDescription) return;
    (async () => {
      setAnalyzing(true);
      try {
        const desc = await analyzeReference(references[0].image_url);
        setStyleDescription(desc);
      } catch (e) {
        toast.error("Style analysis failed: " + (e.response?.data?.detail || e.message));
      } finally {
        setAnalyzing(false);
      }
    })();
  }, [references]);

  const reanalyze = async () => {
    if (!references.length) {
      toast.error("Upload a reference image first");
      return;
    }
    setAnalyzing(true);
    try {
      const desc = await analyzeReference(references[0].image_url);
      setStyleDescription(desc);
      toast.success("Style re-analysed");
    } catch (e) {
      toast.error("Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const doGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt first");
      return;
    }
    setLoading(true);
    try {
      const style_suffix_parts = [];
      if (builtIn?.suffix) style_suffix_parts.push(builtIn.suffix);
      if (references.length && styleDescription) {
        style_suffix_parts.push(`Reference style: ${styleDescription}`);
      }
      const payload = {
        prompt,
        model,
        negative_prompt: negativePrompt || null,
        aspect_ratio: aspect,
        count,
        style_preset_id: savedPresetId || null,
        style_suffix: style_suffix_parts.join("\n") || null,
        reference_image_urls: references.map((r) => r.image_url),
        reference_strength: strength,
      };
      const imgs = await generateImages(payload);
      setResults(imgs);
      toast.success(`Generated ${imgs.length} image${imgs.length > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error("Generation failed: " + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
    }
  };

  const savePreset = async () => {
    if (!references.length) {
      toast.error("Upload at least one reference image to save a preset");
      return;
    }
    const name = window.prompt("Name this style preset:", `My Style ${savedPresets.length + 1}`);
    if (!name?.trim()) return;
    try {
      const preset = await createPreset({
        name: name.trim(),
        reference_image_urls: references.map((r) => r.image_url),
        style_description: styleDescription || null,
        reference_strength: strength,
      });
      setSavedPresets([preset, ...savedPresets]);
      setSavedPresetId(preset.id);
      toast.success(`Saved "${preset.name}"`);
    } catch (e) {
      toast.error("Save failed: " + (e.response?.data?.detail || e.message));
    }
  };

  return (
    <div data-testid={TID.studio.root} className="min-h-full px-6 md:px-10 pt-10 pb-56 max-w-[1400px] mx-auto">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">Studio</div>
        <h1 className="mt-1 text-4xl sm:text-5xl font-heading font-semibold tracking-tight">
          Reference-style image generation
        </h1>
        <p className="mt-2 text-zinc-400 max-w-2xl">
          Upload references, describe what you want, and Google&apos;s Gemini image models will match the
          reference&apos;s lighting, palette and composition — or generate from scratch.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-8">
        {/* LEFT: References + saved presets + strength */}
        <section className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-zinc-500">Reference images</div>
                <div className="text-sm text-zinc-300 mt-0.5">Style · subject · character (up to 4)</div>
              </div>
              <button
                data-testid={TID.studio.saveAsPresetBtn}
                onClick={savePreset}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-md px-2.5 py-1.5 transition-colors"
              >
                <Save className="w-3.5 h-3.5" /> Save as preset
              </button>
            </div>
            <ReferenceUpload references={references} onChange={setReferences} />
          </div>

          {references.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono uppercase tracking-widest text-zinc-500">Auto-extracted style</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                    <Info className="w-3 h-3" /> Edit this to fine-tune how Gemini interprets the style.
                  </div>
                </div>
                <button
                  data-testid={TID.studio.analyzeBtn}
                  onClick={reanalyze}
                  disabled={analyzing}
                  className="text-[11px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40"
                >
                  {analyzing ? "Analysing…" : "Re-analyse"}
                </button>
              </div>
              <textarea
                data-testid={TID.studio.styleDescription}
                value={analyzing ? "Analysing reference style…" : styleDescription}
                onChange={(e) => setStyleDescription(e.target.value)}
                placeholder="Lighting, palette, mood, camera, composition…"
                rows={4}
                className="w-full bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-100 outline-none focus:border-zinc-500 font-mono transition-colors"
              />

              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">
                  Reference strength
                </div>
                <div
                  data-testid={TID.studio.referenceStrength}
                  className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-950/60 border border-zinc-800 p-1"
                >
                  {STRENGTHS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setStrength(s.key)}
                      className={[
                        "text-xs py-1.5 rounded transition-colors",
                        strength === s.key
                          ? "bg-zinc-100 text-zinc-900"
                          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
                      ].join(" ")}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {savedPresets.length > 0 && (
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-3">
                My saved styles
              </div>
              <div className="flex flex-wrap gap-2">
                {savedPresets.map((p) => {
                  const active = savedPresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSavedPresetId(active ? null : p.id)}
                      className={[
                        "flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border transition-colors",
                        active
                          ? "bg-zinc-100 text-zinc-900 border-zinc-100"
                          : "bg-zinc-900 text-zinc-200 border-zinc-800 hover:border-zinc-500",
                      ].join(" ")}
                    >
                      <img
                        src={absoluteUrl(p.thumbnail_url)}
                        alt={p.name}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                      <span className="text-xs font-medium">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-3">
              Or pick a built-in style
            </div>
            <StylePresetGrid selectedId={builtInStyleId} onSelect={(s) => setBuiltInStyleId(s?.id || null)} />
          </div>
        </section>

        {/* RIGHT: Results */}
        <section>
          <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-3">Latest render</div>
          {results.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 h-[500px] flex flex-col items-center justify-center text-center px-8">
              <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
                <Wand2 className="w-5 h-5 text-zinc-400" />
              </div>
              <div className="font-heading text-lg text-zinc-200">Ready when you are</div>
              <div className="text-zinc-500 text-sm mt-1 max-w-xs">
                Write a prompt in the bar below. Add references or a style preset to keep every render on-brand.
              </div>
              <button
                onClick={() => navigate("/bulk")}
                className="mt-6 text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-full px-3 py-1.5 transition-colors"
              >
                Need many at once? Try Bulk →
              </button>
            </div>
          ) : (
            <div className={`grid ${results.length > 1 ? "grid-cols-2" : "grid-cols-1"} gap-3`}>
              {loading &&
                Array.from({ length: count }).map((_, i) => (
                  <div
                    key={"skel-" + i}
                    className="aspect-square rounded-xl border border-zinc-800 bg-zinc-900 animate-pulse"
                  />
                ))}
              {!loading &&
                results.map((r, i) => (
                  <button
                    data-testid={TID.studio.resultCard(i)}
                    key={r.id}
                    onClick={() => setLightbox(r)}
                    className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors"
                  >
                    <img src={absoluteUrl(r.image_url)} alt={r.prompt} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-left translate-y-2 opacity-0 group-hover:opacity-100 group-hover:translate-y-0 transition-[transform,opacity] duration-200">
                      <div className="text-[11px] font-mono text-zinc-300">{r.aspect_ratio} · {r.model.replace("gemini-3", "g3")}</div>
                      <div className="text-xs text-zinc-100 line-clamp-2">{r.prompt}</div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </section>
      </div>

      <FloatingPromptBar
        prompt={prompt}
        onPrompt={setPrompt}
        negativePrompt={negativePrompt}
        onNegativePrompt={setNegativePrompt}
        showNegative={showNegative}
        onToggleNegative={() => setShowNegative((v) => !v)}
        model={model}
        onModel={setModel}
        models={models}
        aspect={aspect}
        onAspect={setAspect}
        count={count}
        onCount={setCount}
        onGenerate={doGenerate}
        loading={loading}
        disabled={!prompt.trim()}
        hint={builtIn ? `+ ${builtIn.name}` : savedPreset ? `+ ${savedPreset.name}` : references.length ? `+ ${references.length} ref` : null}
      />

      {lightbox && (
        <ImageLightbox
          image={lightbox}
          onClose={() => setLightbox(null)}
          onDelete={() => setLightbox(null)}
          onRegenerate={(img) => {
            setPrompt(img.prompt);
            setAspect(img.aspect_ratio || "1:1");
            setLightbox(null);
            setTimeout(doGenerate, 100);
          }}
        />
      )}
    </div>
  );
}
