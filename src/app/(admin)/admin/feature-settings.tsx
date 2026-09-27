import { AlertTriangleIcon, KeyRoundIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { featureDefinitions, featureGroups, type FeatureDefinition } from "@/features/settings/features";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { envConfigured, featureDefault, getFeatureFlags } from "@/server/settings/features";

import { updateFeatureSetting } from "./actions";

const updatedFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** Admin tab listing every system-wide switch, grouped, each saved on its own with an audit entry. */
export async function FeatureSettings({ saved }: { saved?: string }) {
  const [flags, rows] = await Promise.all([
    getFeatureFlags(),
    db.systemSetting.findMany({ select: { key: true, updatedAt: true, updatedBy: { select: { name: true } } } }),
  ]);
  const lastChange = new Map(rows.map((row) => [row.key, row]));
  const features = featureDefinitions as readonly FeatureDefinition[];
  const turnstileReady = envConfigured(["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);

  return <div className="flex flex-col gap-6">
    <p className="rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground">
      สวิตช์ในหน้านี้มีผลกับ<strong className="text-foreground">ทุกโครงการ</strong>ทันทีที่หน้าถัดไปโหลด · ค่าที่ผู้จัดตั้งในแต่ละโครงการ (เช่น ต้องอนุมัติก่อน, เลื่อนคิวอัตโนมัติ) ยังตั้งที่หน้าโครงการเหมือนเดิม · ทุกการเปลี่ยนบันทึก audit log
    </p>

    {featureGroups.map((group) => {
      const items = features.filter((feature) => feature.group === group.value);
      return <section key={group.value} aria-labelledby={`feature-group-${group.value}`} className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-col gap-0.5 border-b bg-secondary px-5 py-3.5">
          <h2 id={`feature-group-${group.value}`} className="font-heading text-lg font-bold">{group.label}</h2>
          <p className="text-sm text-muted-foreground">{group.description}</p>
        </header>
        <ul className="divide-y">
          {group.value === "integration" && <li className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-semibold">Cloudflare Turnstile (กันบอทหน้าสมัคร)</p>
              <p className="text-sm text-muted-foreground">บังคับใช้เสมอบน production — ไม่มีสวิตช์ปิด ถ้ายังไม่ตั้งคีย์ ผู้จัดจะเผยแพร่โครงการบน production ไม่ได้</p>
            </div>
            <EnvBadge ready={turnstileReady} />
          </li>}
          {items.map((feature) => {
            const on = flags[feature.key as keyof typeof flags];
            const notBuilt = feature.availability?.status === "not-built";
            const change = lastChange.get(feature.key);
            const isDefault = !change || on === featureDefault(feature);
            return <li key={feature.key} id={`feature-${feature.key}`} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6", saved === feature.key && "bg-accent/60")}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{feature.label}</p>
                  {notBuilt ? <Badge variant="outline">ยังไม่พัฒนา</Badge> : <Badge variant="secondary" className={on ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}>{on ? "เปิดอยู่" : "ปิดอยู่"}</Badge>}
                  {!notBuilt && !isDefault && <Badge variant="outline" className="text-xs">ไม่ใช่ค่าเริ่มต้น</Badge>}
                  {feature.availability?.env && <EnvBadge ready={envConfigured(feature.availability.env)} />}
                </div>
                <p className="text-sm">{feature.description}</p>
                <p className="text-sm text-muted-foreground"><span className="font-medium">เมื่อปิด:</span> {feature.whenOff}</p>
                {feature.warning && <p className="flex items-start gap-1.5 text-sm text-amber-900"><AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{feature.warning}</p>}
                {feature.availability?.env && <p className="text-xs text-muted-foreground">ต้องตั้งใน .env: <span className="font-mono">{feature.availability.env.join(", ")}</span></p>}
                {change?.updatedBy && <p className="text-xs text-muted-foreground">เปลี่ยนล่าสุดโดย {change.updatedBy.name} · {updatedFormatter.format(change.updatedAt)}</p>}
                {saved === feature.key && <p role="status" className="text-sm font-medium text-primary">บันทึกแล้ว</p>}
              </div>
              <form action={updateFeatureSetting} className="shrink-0">
                <input type="hidden" name="key" value={feature.key} />
                <input type="hidden" name="enabled" value={String(!on)} />
                <button type="submit" role="switch" aria-checked={on} disabled={notBuilt} aria-label={feature.label}
                  className={cn("relative flex h-11 min-w-28 items-center gap-2.5 rounded-full border px-2 pr-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
                  <span aria-hidden="true" className={cn("size-7 rounded-full shadow transition-transform", on ? "order-last bg-primary-foreground" : "bg-input")} />
                  <span className="flex-1 text-center">{on ? "เปิด" : "ปิด"}</span>
                </button>
              </form>
            </li>;
          })}
        </ul>
      </section>;
    })}
  </div>;
}

function EnvBadge({ ready }: { ready: boolean }) {
  return <Badge variant="outline" className={cn("gap-1", ready ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900")}>
    <KeyRoundIcon className="size-3" aria-hidden="true" />{ready ? "ตั้งคีย์แล้ว" : "ยังไม่ตั้งคีย์"}
  </Badge>;
}
