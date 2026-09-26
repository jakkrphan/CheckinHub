"use client";

import { useRef, useState } from "react";
import { FileTextIcon, UploadIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PublicFileField({ id, name, required, acceptedFileTypes, maxFileSizeMb }: {
  id: string;
  name: string;
  required: boolean;
  acceptedFileTypes: string[];
  maxFileSizeMb: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState("");
  const types = acceptedFileTypes.map((type) => type.toLowerCase().replace(/^\./, ""));
  const hintId = `${id}-hint`;

  function clear() {
    if (input.current) input.current.value = "";
    setFile(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <label htmlFor={id} className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-dashed bg-card px-3.5 py-3 transition-colors hover:bg-secondary has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50", error ? "border-destructive" : "border-primary/50", file && "pr-16")}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">{file ? <FileTextIcon className="size-5" aria-hidden="true" /> : <UploadIcon className="size-5" aria-hidden="true" />}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold">{file ? file.name : "แตะเพื่อเลือกไฟล์"}</span>
            <span className="text-xs text-muted-foreground">{file ? `${formatSize(file.size)} · พร้อมส่งพร้อมใบสมัคร` : required ? "จำเป็นต้องแนบไฟล์" : "ไม่บังคับ"}</span>
          </span>
          <input ref={input} id={id} name={name} type="file" required={required} accept={types.map((type) => `.${type}`).join(",")} aria-describedby={hintId} className="sr-only" onChange={(event) => {
            const chosen = event.target.files?.[0];
            setError("");
            if (!chosen) { setFile(null); return; }
            if (chosen.size > maxFileSizeMb * 1024 * 1024) { event.target.value = ""; setFile(null); setError(`ไฟล์ใหญ่เกิน ${maxFileSizeMb} MB`); return; }
            setFile({ name: chosen.name, size: chosen.size });
          }} />
        </label>
        {file && <button type="button" aria-label={`ลบไฟล์ ${file.name}`} onClick={clear} className="absolute top-1/2 right-3.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"><XIcon className="size-4" aria-hidden="true" /></button>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <p id={hintId} className="text-xs text-muted-foreground">รับ {types.join(" / ")} ขนาดไม่เกิน {maxFileSizeMb} MB</p>
    </div>
  );
}
