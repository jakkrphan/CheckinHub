"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Cover image chooser with a 16:9 preview of the current or newly selected file; removal is sent as `removeCover`. */
export function CoverPicker({ currentUrl }: { currentUrl?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const shown = preview ?? (removed ? null : currentUrl ?? null);

  return <div className="flex flex-col gap-3">
    <label htmlFor="coverImage" className="relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-muted text-sm text-muted-foreground hover:bg-muted/70">
      <span className="absolute left-2.5 top-2.5 rounded-md bg-foreground/80 px-2 py-0.5 text-xs font-semibold text-background">16:9</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      {shown ? <img src={shown} alt="ตัวอย่างรูปปก" className="size-full object-cover" /> : <><ImageIcon className="size-6" aria-hidden="true" />ยังไม่มีรูปปก · คลิกเพื่อเลือก</>}
    </label>
    <input ref={input} id="coverImage" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
      const file = event.target.files?.[0];
      setPreview(file ? URL.createObjectURL(file) : null);
      if (file) setRemoved(false);
    }} />
    {removed && <input type="hidden" name="removeCover" value="on" />}
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="lg" className="h-10 flex-1" onClick={() => input.current?.click()}><UploadIcon data-icon="inline-start" aria-hidden="true" />{shown ? "เปลี่ยนรูป" : "เลือกรูป"}</Button>
      {shown && <Button type="button" variant="outline" size="lg" className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => {
        if (input.current) input.current.value = "";
        setPreview(null);
        setRemoved(!!currentUrl);
      }}><Trash2Icon data-icon="inline-start" aria-hidden="true" />ลบ</Button>}
    </div>
  </div>;
}
