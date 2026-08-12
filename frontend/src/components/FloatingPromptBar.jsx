import React from "react";
import { ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { TID } from "@/constants/testIds";

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/**
 * A glassmorphic floating prompt bar with model / aspect / count selectors and Generate button.
 */
export default function FloatingPromptBar({
  prompt,
  onPrompt,
  negativePrompt,
  showNegative,
  onToggleNegative,
  onNegativePrompt,
  model,
  onModel,
  models,
  aspect,
  onAspect,
  count,
  onCount,
  onGenerate,
  loading,
  disabled,
  hint,
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-xl shadow-2xl">
        {showNegative && (
          <div className="px-4 pt-3">
            <input
              data-testid={TID.studio.negativePromptInput}
              value={negativePrompt}
              onChange={(e) => onNegativePrompt(e.target.value)}
              placeholder="Negative prompt — what should NOT appear"
              className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 outline-none font-mono"
            />
          </div>
        )}

        <div className="p-2 flex items-end gap-2">
          <div className="flex-1 rounded-xl bg-zinc-950/60 border border-zinc-800/70 px-4 py-3">
            <textarea
              data-testid={TID.studio.promptInput}
              rows={2}
              value={prompt}
              onChange={(e) => onPrompt(e.target.value)}
              placeholder="Describe the image — e.g. product shot of a red sneaker on a marble backdrop"
              className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none font-mono"
            />
            <div className="flex items-center justify-between mt-2">
              <button
                data-testid={TID.studio.negativePromptToggle}
                onClick={onToggleNegative}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showNegative ? "− hide negative prompt" : "+ add negative prompt"}
              </button>
              {hint && <span className="text-[11px] text-zinc-500 font-mono">{hint}</span>}
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-[300px]">
            <div className="grid grid-cols-2 gap-2">
              <label className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">Model</div>
                <div className="relative flex items-center">
                  <select
                    data-testid={TID.studio.modelSelect}
                    value={model}
                    onChange={(e) => onModel(e.target.value)}
                    className="w-full bg-transparent text-[12px] text-zinc-100 outline-none appearance-none pr-4"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} className="bg-zinc-900">
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-0" />
                </div>
              </label>

              <label className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">Count</div>
                <div className="relative flex items-center">
                  <select
                    data-testid={TID.studio.countSelect}
                    value={count}
                    onChange={(e) => onCount(Number(e.target.value))}
                    className="w-full bg-transparent text-[12px] text-zinc-100 outline-none appearance-none pr-4"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n} className="bg-zinc-900">
                        {n} image{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-0" />
                </div>
              </label>
            </div>

            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/70 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mb-1">Aspect ratio</div>
              <div className="flex gap-1">
                {RATIOS.map((r) => (
                  <button
                    key={r}
                    data-testid={TID.studio.aspectRatio(r)}
                    onClick={() => onAspect(r)}
                    className={[
                      "flex-1 text-[11px] py-1 rounded font-mono transition-colors",
                      aspect === r
                        ? "bg-zinc-100 text-zinc-900"
                        : "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            data-testid={TID.studio.generateBtn}
            onClick={onGenerate}
            disabled={disabled || loading}
            className={[
              "h-full min-h-[110px] px-5 rounded-xl text-sm font-semibold tracking-tight",
              "transition-[transform,background-color] duration-150",
              "disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]",
              loading ? "btn-generate-loading" : "bg-zinc-100 text-zinc-900 hover:bg-white",
            ].join(" ")}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Rendering
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Generate
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
