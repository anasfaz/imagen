import React, { useCallback, useState } from "react";
import { UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { uploadReference, absoluteUrl } from "@/lib/api";
import { TID } from "@/constants/testIds";

export default function ReferenceUpload({ references, onChange, max = 4 }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const doUpload = useCallback(
    async (files) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!list.length) return;
      if (references.length + list.length > max) {
        toast.error(`Max ${max} references`);
        return;
      }
      setUploading(true);
      try {
        const uploaded = [];
        for (const f of list) {
          const res = await uploadReference(f);
          uploaded.push(res);
        }
        onChange([...references, ...uploaded]);
        toast.success(`${uploaded.length} reference${uploaded.length > 1 ? "s" : ""} added`);
      } catch (e) {
        toast.error("Upload failed: " + (e.response?.data?.detail || e.message));
      } finally {
        setUploading(false);
      }
    },
    [references, onChange, max],
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  };

  const remove = (idx) => {
    const next = references.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div
        data-testid={TID.studio.referenceUpload}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "relative rounded-xl border border-dashed p-6 text-center cursor-pointer",
          "transition-[background-color,border-color] duration-150",
          dragOver
            ? "border-zinc-200 bg-zinc-800/70"
            : "border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/70",
        ].join(" ")}
        onClick={() => document.getElementById("ref-file-input")?.click()}
      >
        <input
          id="ref-file-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && doUpload(e.target.files)}
        />
        <UploadCloud className="w-6 h-6 mx-auto text-zinc-400" />
        <div className="mt-2 text-sm font-medium text-zinc-200">
          {uploading ? "Uploading…" : "Drop reference image(s) or click to browse"}
        </div>
        <div className="text-[11px] text-zinc-500 mt-1 font-mono">
          up to {max} images · style + subject · JPG / PNG / WebP
        </div>
      </div>

      {references.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {references.map((r, i) => (
            <div
              key={r.storage_path || i}
              data-testid={TID.studio.referenceCard(i)}
              className="relative aspect-square rounded-lg overflow-hidden border border-zinc-800 group"
            >
              <img
                src={absoluteUrl(r.image_url)}
                alt="reference"
                className="w-full h-full object-cover"
              />
              <button
                data-testid={TID.studio.referenceRemove(i)}
                onClick={() => remove(i)}
                className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-zinc-950/80 border border-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
