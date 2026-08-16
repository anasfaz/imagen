import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Images } from "lucide-react";
import { listGallery, deleteGeneration, absoluteUrl } from "@/lib/api";
import ImageLightbox from "@/components/ImageLightbox";
import RemixDialog from "@/components/RemixDialog";
import { TID } from "@/constants/testIds";

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [remix, setRemix] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const g = await listGallery(120, 0);
      setItems(g);
    } finally {
      setLoading(false);
    }
  }

  const del = async (img) => {
    try {
      await deleteGeneration(img.id);
      setItems((prev) => prev.filter((i) => i.id !== img.id));
      setLightbox(null);
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div data-testid={TID.gallery.root} className="min-h-full px-6 md:px-10 py-10 max-w-[1400px] mx-auto">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">Gallery</div>
        <h1 className="mt-1 text-4xl sm:text-5xl font-heading font-semibold tracking-tight">
          Everything you&apos;ve rendered
        </h1>
        <p className="mt-2 text-zinc-400">
          {items.length} image{items.length === 1 ? "" : "s"} · click any tile to open the lightbox.
        </p>
      </header>

      {loading ? (
        <div className="masonry">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" style={{ height: 200 + (i % 4) * 80 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 h-[420px] flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
            <Images className="w-5 h-5 text-zinc-400" />
          </div>
          <div className="font-heading text-lg text-zinc-200">No renders yet</div>
          <div className="text-zinc-500 text-sm mt-1">Head to the Studio to generate your first image.</div>
        </div>
      ) : (
        <div className="masonry">
          {items.map((img) => (
            <button
              key={img.id}
              data-testid={TID.gallery.card(img.id)}
              onClick={() => setLightbox(img)}
              className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors block w-full"
            >
              <img
                src={absoluteUrl(img.image_url)}
                alt={img.prompt}
                className="w-full h-auto"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-x-0 bottom-0 p-3 text-left translate-y-1 opacity-0 group-hover:opacity-100 group-hover:translate-y-0 transition-[transform,opacity] duration-200">
                <div className="text-[10px] font-mono text-zinc-300 uppercase tracking-widest">
                  {img.aspect_ratio || "1:1"}
                </div>
                <div className="text-xs text-zinc-100 line-clamp-2">{img.prompt}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          image={lightbox}
          onClose={() => setLightbox(null)}
          onDelete={del}
          onRemix={(img) => {
            setLightbox(null);
            setRemix(img);
          }}
          onRegenerate={(img) => {
            const q = new URLSearchParams({ prompt: img.prompt, aspect: img.aspect_ratio || "1:1" });
            window.location.href = `/studio?${q.toString()}`;
          }}
        />
      )}
      {remix && <RemixDialog generation={remix} onClose={() => setRemix(null)} />}
    </div>
  );
}
