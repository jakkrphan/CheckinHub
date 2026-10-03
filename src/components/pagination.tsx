import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import type { PageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const control = "inline-flex min-h-9 items-center gap-1 rounded-md border px-3 text-sm font-medium";

/**
 * Previous / "หน้า x / y" / next for server-rendered lists. Always shown while the list has rows, so the total and
 * the page position are visible even when everything fits on one page (both buttons are then disabled).
 * `hrefFor` must keep the list's current filters so paging never drops a search.
 */
export function Pagination({ label, paging, unit, hrefFor, className }: {
  /** Accessible name, e.g. "หน้ารายการผู้ใช้". */
  label: string;
  paging: PageWindow;
  /** Counted thing, e.g. "บัญชี". */
  unit: string;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (paging.total === 0) return null;
  const { current, pageCount, from, to, total } = paging;
  return <nav aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3 text-sm", className)}>
    <span className="text-xs text-muted-foreground">แสดง {from.toLocaleString("th-TH")}–{to.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} {unit}</span>
    <span className="flex items-center gap-2">
      {current > 1
        ? <Link href={hrefFor(current - 1)} rel="prev" className={cn(control, "bg-card hover:bg-muted")}><ChevronLeftIcon className="size-4" aria-hidden="true" />ก่อนหน้า</Link>
        : <span aria-disabled="true" className={cn(control, "text-muted-foreground opacity-50")}><ChevronLeftIcon className="size-4" aria-hidden="true" />ก่อนหน้า</span>}
      <span className="px-1 text-muted-foreground tabular-nums" aria-current="page">หน้า {current.toLocaleString("th-TH")} / {pageCount.toLocaleString("th-TH")}</span>
      {current < pageCount
        ? <Link href={hrefFor(current + 1)} rel="next" className={cn(control, "bg-card hover:bg-muted")}>ถัดไป<ChevronRightIcon className="size-4" aria-hidden="true" /></Link>
        : <span aria-disabled="true" className={cn(control, "text-muted-foreground opacity-50")}>ถัดไป<ChevronRightIcon className="size-4" aria-hidden="true" /></span>}
    </span>
  </nav>;
}
