import React from "react";
import { TID } from "@/constants/testIds";

// Built-in text-only style presets (append to prompt as style suffix).
// The user's saved reference-based presets live in a separate collection.
export const BUILT_IN_STYLES = [
  { id: "cinematic", name: "Cinematic", suffix: "cinematic still, dramatic lighting, film grain, shallow depth of field, anamorphic lens flare", thumb: "https://images.pexels.com/photos/13226337/pexels-photo-13226337.jpeg" },
  { id: "anime", name: "Anime", suffix: "anime illustration style, cel shading, expressive linework, vibrant palette, key visual", thumb: "https://images.pexels.com/photos/34062274/pexels-photo-34062274.jpeg" },
  { id: "3d_render", name: "3D Render", suffix: "octane render 3D, subsurface scattering, soft studio lighting, high detail, photoreal materials", thumb: "https://images.pexels.com/photos/29450016/pexels-photo-29450016.jpeg" },
  { id: "photorealistic", name: "Photoreal", suffix: "hyper photorealistic, DSLR photograph, 85mm lens, natural lighting, sharp focus, rich detail", thumb: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwxfHxwaG90b3JlYWxpc3RpYyUyMGh1bWFuJTIwcG9ydHJhaXR8ZW58MHx8fHwxNzg2NTIwNjY5fDA&ixlib=rb-4.1.0&q=85" },
  { id: "watercolor", name: "Watercolor", suffix: "loose watercolour painting, wet-on-wet washes, visible paper texture, hand-painted, delicate palette", thumb: "https://images.pexels.com/photos/30072885/pexels-photo-30072885.jpeg" },
  { id: "cyberpunk", name: "Cyberpunk", suffix: "cyberpunk aesthetic, neon signage, rain-slicked streets, moody teal and magenta, high contrast", thumb: "https://images.pexels.com/photos/31413138/pexels-photo-31413138.jpeg" },
  { id: "product_shot", name: "Product Shot", suffix: "commercial product photography, seamless backdrop, studio softbox lighting, crisp reflections, minimal composition", thumb: "https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2OTV8MHwxfHNlYXJjaHwxfHxtaW5pbWFsaXN0JTIwcHJvZHVjdCUyMHBob3RvZ3JhcGh5fGVufDB8fHx8MTc4NjUyMDY2OXww&ixlib=rb-4.1.0&q=85" },
  { id: "portrait", name: "Portrait", suffix: "editorial portrait photography, Rembrandt lighting, tight crop, moody background, magazine cover quality", thumb: "https://images.pexels.com/photos/12695346/pexels-photo-12695346.jpeg" },
];

export default function StylePresetGrid({ selectedId, onSelect }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {BUILT_IN_STYLES.map((s) => {
        const active = selectedId === s.id;
        return (
          <button
            key={s.id}
            data-testid={TID.studio.presetChip(s.id)}
            onClick={() => onSelect(active ? null : s)}
            className={[
              "relative aspect-square rounded-lg overflow-hidden border-2 group text-left",
              "transition-[border-color,transform] duration-150",
              active ? "border-zinc-100 ring-2 ring-zinc-100/20" : "border-transparent hover:border-zinc-500",
            ].join(" ")}
          >
            <img
              src={s.thumb}
              alt={s.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between">
              <span className="text-xs font-medium text-white leading-none">{s.name}</span>
              {active && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">on</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function findBuiltInById(id) {
  return BUILT_IN_STYLES.find((s) => s.id === id);
}
