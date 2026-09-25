"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Copies text to the clipboard and confirms inline; falls back silently when clipboard access is blocked. */
export function CopyButton({ value, label = "คัดลอก" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <Button type="button" variant="outline" size="sm" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* user can still select the text */ }
  }}>{copied ? <CheckIcon data-icon="inline-start" aria-hidden="true" /> : <CopyIcon data-icon="inline-start" aria-hidden="true" />}<span aria-live="polite">{copied ? "คัดลอกแล้ว" : label}</span></Button>;
}
