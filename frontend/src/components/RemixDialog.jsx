import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Wand2, Loader2, Layers, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { remixPrompt } from "@/lib/api";
import { TID } from "@/constants/testIds";

/**
 * Modal that spawns N smart variations of a gallery image's prompt.
 * Users can toggle prompts on/off and send the selection to the Bulk page.
 */
export default function RemixDialog({ generation, onClose }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [prompts, setPrompts] = useState([]);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (!generation) return;
    load();
  }, [generation?.id]);

  async function load() {
    setLoading(true);
    try {
      const p = await remixPrompt(generation.id, 10);
      setPrompts(p);
      setSelected(new Set(p.map((_, i) => i)));
    } catch (e) {
      toast.error("Remix failed: " + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
    }
  }

  const toggle = (i) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  };

  const sendToBulk = () => {
    const picks = prompts.filter((_, i) => selected.has(i));
    if (!picks.length) {
      toast.error("Select at least one variation");
      return;
    }
    sessionStorage.setItem(
      "bulk-prefill",
      JSON.stringify({
        prompts: picks.join("\n"),
        model: generation.model,
        aspect_ratio: generation.aspect_ratio,
      }),
    );
    onClose();
    navigate("/bulk");
  };

  if (!generation) return null;

  return (
    <div
      data-testid={TID.remix.dialog}
      className="fixed inset-0 z-[80] backdrop-blur-xl bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Prompt remix</div>
            <div className="font-heading text-xl tracking-tight mt-1 flex items-center gap-2">
              <Wand2 className="w-4 h-4" /> 10 smart variations of your prompt
            </div>
            <div className="text-[11.5px] text-zinc-500 mt-1 line-clamp-2 font-mono">
              base: {generation.prompt}
            </div>
          </div>
          <button
            data-testid={TID.remix.close}
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll -mx-2 px-2">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div className="text-sm">Cooking up variations…</div>
            </div>
          ) : (
            <ul className="space-y-2">
              {prompts.map((p, i) => {
                const active = selected.has(i);
                return (
                  <li
                    key={i}
                    data-testid={TID.remix.promptRow(i)}
                    onClick={() => toggle(i)}
                    className={[
                      "cursor-pointer rounded-lg p-3 border transition-colors",
                      active
                        ? "border-zinc-100 bg-zinc-950/70"
                        : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        data-testid={TID.remix.togglePrompt(i)}
                        type="checkbox"
                        readOnly
                        checked={active}
                        className="mt-1 accent-zinc-100"
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(i)}
                      />
                      <div className="text-sm text-zinc-200 font-mono leading-relaxed">{p}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-800/70">
          <button
            data-testid={TID.remix.regenerate}
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Regenerate
          </button>
          <button
            data-testid={TID.remix.sendToBulk}
            onClick={sendToBulk}
            disabled={loading || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Layers className="w-4 h-4" /> Send {selected.size} to Bulk
          </button>
        </div>
      </div>
    </div>
  );
}
