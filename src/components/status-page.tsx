import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Shared layout for 404 / 403 / error / rate-limit states so every failure explains itself and offers a way out. */
export function StatusPage({ icon: Icon, code, title, description, actions, fullPage = false, tone = "neutral" }: {
  icon: LucideIcon;
  code?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  fullPage?: boolean;
  tone?: "neutral" | "danger" | "warning";
}) {
  return <main className={cn("flex w-full flex-1 items-center justify-center px-5 py-16", fullPage && "min-h-svh bg-background")}>
    <section className="flex w-full max-w-md flex-col items-center gap-5 text-center" aria-labelledby="status-title">
      <span className={cn("flex size-16 items-center justify-center rounded-2xl",
        tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-accent text-accent-foreground")}>
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        {code && <p className="font-mono text-sm font-semibold text-muted-foreground">{code}</p>}
        <h1 id="status-title" className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </section>
  </main>;
}
