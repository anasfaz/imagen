import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Download, Sparkles } from "lucide-react";
import { getPublicShare, absoluteUrl } from "@/lib/api";
import { TID } from "@/constants/testIds";

/** Public read-only view for a single generation. Available at /s/:id */
export default function SharedImage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getPublicShare(id).then(setData).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [id]);

  const download = async () => {
    if (!data) return;
    const url = absoluteUrl(data.image_url);
    const resp = await fetch(url);
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.prompt || "image").slice(0, 40).replace(/\s+/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div data-testid={TID.share.root} className="min-h-screen w-full bg-zinc-950 text-zinc-100 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
        backgroundSize: "4px 4px",
      }} />

      <header className="relative flex items-center justify-between px-6 md:px-10 py-5 border-b border-zinc-900/70">
        <Link to="/studio" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-md bg-zinc-100 text-zinc-900 grid place-items-center">
            <Sparkles className="w-4 h-4" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-heading font-semibold text-[15px] tracking-tight group-hover:text-white transition-colors">
              Imagen Studio
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">shared render</div>
          </div>
        </Link>
        <Link
          to="/studio"
          className="text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-full px-3 py-1.5 transition-colors"
        >
          Make your own →
        </Link>
      </header>

      <main className="relative max-w-5xl mx-auto px-6 md:px-10 py-10">
        {err ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-10 text-center text-zinc-400">
            {err.includes("not found") ? "This share link no longer exists." : err}
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 h-[500px] animate-pulse" />
        ) : (
          <article className="space-y-6">
            <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950">
              <img
                data-testid={TID.share.image}
                src={absoluteUrl(data.image_url)}
                alt={data.prompt}
                className="w-full h-auto"
              />
            </div>

            <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Prompt</div>
                <p
                  data-testid={TID.share.prompt}
                  className="mt-1 text-lg text-zinc-100 leading-relaxed font-heading tracking-tight"
                >
                  {data.prompt}
                </p>
                <div className="mt-3 flex gap-3 text-[11px] font-mono text-zinc-500">
                  <span>{data.model}</span>
                  <span>·</span>
                  <span>{data.aspect_ratio || "1:1"}</span>
                  {data.created_at && (
                    <>
                      <span>·</span>
                      <span>{new Date(data.created_at).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={download}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2 text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" /> Download image
              </button>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
