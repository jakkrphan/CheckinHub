"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QrCodeIcon } from "lucide-react";

import { checkInCode, checkInCodeForm, overrideCheckIn, type ScanResult } from "@/app/(check-in)/check-in/[eventId]/actions";
import { signalResult, unlockAudio } from "@/app/(check-in)/check-in/[eventId]/feedback";
import { discardRejectedScans, listReviewScans, pendingScanCount, queueScan, syncQueuedScans, type ReviewScan } from "@/app/(check-in)/check-in/[eventId]/offline-queue";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}

type DisplayResult = ScanResult | { kind: "queued"; message: string; canOverride?: undefined };

const reviewTime = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/**
 * `kiosk` mode is for attendees scanning their own QR: no override, no staff tools, and the result clears itself
 * so the next person never sees the previous one.
 */
export function Scanner({ eventId, sessionId, operatorId, sessionLabels, mode = "staff" }: { eventId: string; sessionId: string; operatorId: string; sessionLabels: Record<string, string>; mode?: "staff" | "kiosk" }) {
  const kiosk = mode === "kiosk";
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const last = useRef({ code: "", at: 0 });
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResultState] = useState<DisplayResult | null>(null);
  const [overrideCode, setOverrideCode] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewScan[]>([]);
  const [cameraError, setCameraError] = useState("");
  const [pending, setPending] = useState(0);
  const [needsReview, setNeedsReview] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const syncing = useRef(false);

  function setResult(next: DisplayResult | null, scannedCode = "") {
    setResultState(next);
    setOverrideCode(!kiosk && next?.kind === "wrong-day" && next.canOverride ? scannedCode : "");
    if (!next) return;
    signalResult(next.kind === "success" ? "success" : next.kind === "duplicate" || next.kind === "wrong-day" || next.kind === "queued" ? "warning" : "error");
  }

  async function refreshPending() { setPending(await pendingScanCount(operatorId)); }
  async function refreshReview() { setReviewItems(await listReviewScans(operatorId)); }

  async function queue(value: string) {
    try {
      await queueScan(operatorId, eventId, sessionId, value);
      await refreshPending();
      setResult({ kind: "queued", message: "ยังไม่บันทึกบนเซิร์ฟเวอร์ — เข้าคิวรอซิงก์เมื่อออนไลน์" });
      setCode("");
    } catch {
      setResult({ kind: "error", message: "บันทึกคิวในเครื่องไม่ได้ กรุณาเก็บ QR ไว้และลองใหม่" });
    }
  }

  async function sync(retryRejected = false) {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      const summary = await syncQueuedScans(operatorId, checkInCode, retryRejected);
      setPending(summary.pending);
      setNeedsReview(summary.needsReview);
      await refreshReview();
      const other = summary.alreadyChecked ? ` · ${summary.alreadyChecked} รายการมีการเช็คจากเครื่องอื่นแล้ว` : "";
      if (summary.rejected) setResult({ kind: "error", message: `ซิงก์แล้ว ${summary.synced} รายการ${other} แต่มี ${summary.rejected} รายการไม่ได้บันทึกและต้องตรวจสอบ (ดูรายการด้านล่าง)` });
      else if (summary.blocked) setResult({ kind: "error", message: "บางรายการยังซิงก์ไม่ได้ รายการยังอยู่ในเครื่อง กรุณาลองใหม่หรือแจ้งผู้จัด" });
      else if (summary.synced || summary.alreadyChecked) setResult({ kind: "success", message: `ซิงก์เช็คชื่อสำเร็จ ${summary.synced} รายการ${other}` });
    } catch {
      await refreshPending().catch(() => undefined);
      setResult({ kind: "error", message: "ซิงก์คิวออฟไลน์ไม่สำเร็จ รายการยังอยู่ในเครื่อง กรุณาลองใหม่หรือแจ้งผู้จัด" });
    } finally { syncing.current = false; }
  }

  async function submit(raw: string, source: "camera" | "scanner") {
    const value = raw.trim();
    if (!value || busy.current) return;
    if (value.length > 200) { setResult({ kind: "invalid", message: "รหัส QR ยาวเกินไป" }); return; }
    if (last.current.code === value && Date.now() - last.current.at < 3000) return;
    busy.current = true;
    last.current = { code: value, at: Date.now() };
    try {
      if (!navigator.onLine) await queue(value);
      else {
        setResult(await checkInCode(eventId, sessionId, value, crypto.randomUUID(), undefined, kiosk ? "kiosk" : source), value);
        setCode("");
      }
    } catch {
      await queue(value);
    } finally { busy.current = false; }
  }

  async function submitOverride() {
    if (!overrideCode || busy.current) return;
    busy.current = true;
    try {
      const next = await overrideCheckIn(eventId, sessionId, overrideCode, overrideNote);
      setResult(next, overrideCode);
      if (next.kind === "success") setOverrideNote("");
    } catch {
      setResult({ kind: "error", message: "บันทึกกรณีพิเศษไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่" });
    } finally { busy.current = false; }
  }

  useEffect(() => {
    if (!kiosk || !result) return;
    const timer = window.setTimeout(() => setResultState(null), 5000);
    return () => window.clearTimeout(timer);
  }, [kiosk, result]);

  useEffect(() => {
    // Unsynced scans live only on this device; warn before the tab is closed or navigated away.
    if (pending === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  useEffect(() => {
    void pendingScanCount(operatorId).then((count) => { setPending(count); void refreshReview(); void sync(); }).catch(() => setResult({ kind: "error", message: "เปิดคิวออฟไลน์ไม่ได้ กรุณาเช็คชื่อขณะออนไลน์" }));
    const onOnline = () => { void sync(); };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void sync(); }, 15000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(timer); };
    // Queue functions do not depend on the current input state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, sessionId, operatorId]);

  useEffect(() => {
    if (!camera || !video.current) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserQRCodeReader();
    reader.decodeFromVideoDevice(undefined, video.current, (scan) => {
      if (!cancelled && scan) void submit(scan.getText(), "camera");
    }).then((current) => { if (cancelled) current.stop(); else controls = current; }).catch(() => setCameraError("เปิดกล้องไม่ได้ กรุณาตรวจสิทธิ์กล้องหรือใช้เครื่องยิงแทน"));
    return () => { cancelled = true; controls?.stop(); };
    // Camera lifecycle is tied to the selected session and camera toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, eventId, sessionId]);

  return <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-semibold">สแกนเช็คชื่อ</h2><p className="text-sm text-muted-foreground">ส่อง QR ให้อยู่ในกรอบ หรือใช้เครื่องยิง</p></div><QrCodeIcon className="size-6 text-primary" aria-hidden="true" /></div>
    <div className="relative flex aspect-square max-h-80 items-center justify-center overflow-hidden rounded-xl bg-background">
      {camera ? <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" /> : <div className="flex flex-col items-center gap-2 text-center text-muted-foreground"><QrCodeIcon className="size-12" aria-hidden="true" /><span className="text-sm">เปิดกล้องเพื่อเริ่มสแกน</span></div>}
      <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] border-4 border-primary/80 rounded-2xl" />
    </div>
    <Button type="button" variant="outline" onClick={() => { setCameraError(""); setCamera(!camera); }}>{camera ? "ปิดกล้อง" : "เปิดกล้อง"}</Button>
    <form action={checkInCodeForm.bind(null, eventId, sessionId)} className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void submit(code, "scanner"); }}><FieldGroup><Field><FieldLabel htmlFor="scan-code">เครื่องยิง / พิมพ์รหัส QR</FieldLabel><Input id="scan-code" name="code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="สแกนหรือพิมพ์รหัส QR" autoComplete="off" /></Field></FieldGroup><Button type="submit">เช็คชื่อ</Button></form>
    {!kiosk && <div className="flex flex-wrap items-center gap-3 text-sm"><span className={online ? "text-primary" : "text-muted-foreground"}>{online ? "ออนไลน์" : "ออฟไลน์"} · ค้างในเครื่อง {pending} รายการ{needsReview ? ` (ต้องตรวจสอบ ${needsReview})` : ""}</span>{pending > 0 && <Button type="button" size="sm" variant="outline" disabled={!online} onClick={() => void sync(true)}>ลองซิงก์อีกครั้ง</Button>}{needsReview > 0 && <Button type="button" size="sm" variant="destructive" onClick={async () => { if (!window.confirm(`ยืนยันลบ ${needsReview} รายการที่ตรวจไม่ผ่าน? การลบนี้กู้คืนไม่ได้และไม่ได้เช็คชื่อให้`)) return; const removed = await discardRejectedScans(operatorId); setNeedsReview(0); setReviewItems([]); await refreshPending(); setResult({ kind: "error", message: `ลบ ${removed} รายการที่ตรวจไม่ผ่านจากเครื่องแล้ว (ไม่ได้เช็คชื่อ)` }); }}>ลบรายการที่ตรวจไม่ผ่าน</Button>}</div>}
    {kiosk && (!online || pending > 0) && <p className="text-sm text-muted-foreground">{online ? "" : "ออฟไลน์ · "}รอส่งข้อมูล {pending} รายการ กรุณาแจ้งเจ้าหน้าที่</p>}
    {cameraError && <p role="alert" className="mt-2 text-sm text-red-200">{cameraError}</p>}
    {!kiosk && reviewItems.length > 0 && <section aria-label="รายการที่ต้องตรวจสอบ" className="rounded-lg border border-red-400/60 p-3 text-sm">
      <h3 className="font-semibold text-red-200">ต้องตรวจสอบ — ยังไม่ได้เช็คชื่อ</h3>
      <ul className="mt-2 flex flex-col gap-1">{reviewItems.map((item) => <li key={item.id} className="flex flex-col border-t pt-1 first:border-t-0 first:pt-0"><span>{reviewTime.format(item.queuedAt)} · {sessionLabels[item.sessionId] ?? "รอบที่ถูกลบแล้ว"}</span><span className="text-xs text-muted-foreground">{item.message}</span></li>)}</ul>
    </section>}
    {result && <div role="status" className={cn("mt-4 flex flex-col gap-3 rounded-lg border-2 p-4 font-semibold", kiosk && "p-6 text-center text-2xl", result.kind === "success" ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : result.kind === "queued" ? "border-muted-foreground/40 bg-muted" : result.kind === "duplicate" || result.kind === "wrong-day" ? "border-amber-400 bg-amber-500/15 text-amber-100" : "border-red-400 bg-red-500/15 text-red-200")}>
      <p>{result.message}</p>
      {overrideCode && <form className="flex flex-col gap-2 font-normal text-foreground" onSubmit={(event) => { event.preventDefault(); void submitOverride(); }}>
        <label htmlFor="override-note" className="text-sm">อนุญาตเป็นกรณีพิเศษ (บันทึกเหตุผลลง audit log)</label>
        <div className="flex gap-2"><Input id="override-note" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} maxLength={500} placeholder="เช่น ผู้บริหารเข้าร่วมแทน" required minLength={3} /><Button type="submit" variant="outline">อนุญาต</Button></div>
      </form>}
    </div>}
  </section>;
}
