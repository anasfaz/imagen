import React, { useEffect, useState } from "react";
import { X, Download, Copy, Trash2, RefreshCw, Wand2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { absoluteUrl, BACKEND_URL } from "@/lib/api";
import { TID } from "@/constants/testIds";

export default function ImageLightbox({ image, onClose, onDelete, onRegenerate, onRemix }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!image) return null;

  const download = async () => {
    try {
      const url = absoluteUrl(image.image_url);
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(image.prompt || "image").slice(0, 40).replace(/\s+/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(image.prompt || "");
      toast.success("Prompt copied");
    } catch {
      toast.error("Clipboard blocked");
    }
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/s/${image.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public share link copied");
    } catch {
      toast.error("Clipboard blocked");
    }
  };

  return (
    <div
      data-testid={TID.gallery.lightbox}
      className="fixed inset-0 z-[70] backdrop-blur-xl bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <button
        data-testid={TID.gallery.lightboxClose}
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-800 grid place-items-center transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="w-5 h-5" />
      </button>

      <div
        className="relative w-full max-w-5xl grid md:grid-cols-[minmax(0,1fr)_320px] gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center">
          <img
            src={absoluteUrl(image.image_url)}
            alt={image.prompt}
            className="max-h-[80vh] w-auto max-w-full object-contain"
          />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-md p-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase text-zinc-500 tracking-widest font-mono">Prompt</div>
            <div className="mt-1 text-sm text-zinc-100 leading-relaxed">{image.prompt}</div>
          </div>
          {image.negative_prompt && (
            <div>
              <div className="text-[10px] uppercase text-zinc-500 tracking-widest font-mono">Negative</div>
              <div className="mt-1 text-xs text-zinc-300">{image.negative_prompt}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="rounded bg-zinc-950/60 px-2 py-1.5 border border-zinc-800">
              <div className="text-zinc-500">Model</div>
              <div className="text-zinc-200 truncate">{image.model}</div>
            </div>
            <div className="rounded bg-zinc-950/60 px-2 py-1.5 border border-zinc-800">
              <div className="text-zinc-500">Aspect</div>
              <div className="text-zinc-200">{image.aspect_ratio || "1:1"}</div>
            </div>
            {image.reference_strength && (
              <div className="rounded bg-zinc-950/60 px-2 py-1.5 border border-zinc-800 col-span-2">
                <div className="text-zinc-500">Reference strength</div>
                <div className="text-zinc-200 capitalize">{image.reference_strength}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              data-testid={TID.gallery.lightboxDownload}
              onClick={download}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white px-3 py-2 text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            <button
              data-testid={TID.gallery.lightboxCopyPrompt}
              onClick={copyPrompt}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 text-sm transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy prompt
            </button>
            <button
              data-testid={TID.lightbox.remixBtn}
              onClick={() => onRemix?.(image)}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 text-sm transition-colors"
            >
              <Wand2 className="w-4 h-4" /> Remix 10
            </button>
            <button
              data-testid={TID.lightbox.shareBtn}
              onClick={copyShareLink}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 text-sm transition-colors"
            >
              <Share2 className="w-4 h-4" /> Share link
            </button>
            <button
              data-testid={TID.gallery.lightboxRegenerate}
              onClick={() => onRegenerate?.(image)}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 text-sm transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Regenerate
            </button>
            <button
              data-testid={TID.gallery.lightboxDelete}
              onClick={() => onDelete?.(image)}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-red-950/50 hover:border-red-900 text-red-400 px-3 py-2 text-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
