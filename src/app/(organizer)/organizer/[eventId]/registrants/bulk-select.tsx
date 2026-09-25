"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Wraps the registrant list so row checkboxes feed one bulk-approve form.
 * The sticky bar only becomes actionable once something is selected.
 */
export function BulkSelectForm({ action, children, selectable }: { action: (formData: FormData) => Promise<void>; children: ReactNode; selectable: number }) {
  const [count, setCount] = useState(0);
  return <form action={action} className="flex min-h-0 flex-1 flex-col" onChange={(event) => setCount(event.currentTarget.querySelectorAll<HTMLInputElement>('input[name="registrantId"]:checked').length)}>
    <div className="min-h-0 flex-1 lg:overflow-y-auto">{children}</div>
    {selectable > 0 && <div className="sticky bottom-0 z-10 flex shrink-0 items-center lg:static justify-between gap-3 border-t bg-sidebar px-4 py-3 text-sidebar-foreground">
      <span className="text-sm font-semibold" aria-live="polite">{count ? `เลือก ${count} คน` : "ติ๊กเลือกผู้รออนุมัติเพื่ออนุมัติพร้อมกัน"}</span>
      <Button type="submit" size="sm" disabled={!count} className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">อนุมัติที่เลือก</Button>
    </div>}
  </form>;
}
