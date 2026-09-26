"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarXIcon, CameraIcon, CheckIcon, CloudOffIcon, CopyCheckIcon, KeyboardIcon, LockIcon, ScanBarcodeIcon, Undo2Icon, Volume2Icon, VolumeXIcon, WifiOffIcon } from "lucide-react";

import { checkInCode, checkInCodeForm, overrideCheckIn, undoCheckIn, type ScanResult } from "@/app/(check-in)/check-in/[eventId]/actions";
import { isMuted, setMuted, signalResult, subscribeMuted, unlockAudio } from "@/app/(check-in)/check-in/[eventId]/feedback";
import { discardRejectedScans, listReviewScans, pendingScanCount, queueScan, syncQueuedScans, type ReviewScan } from "@/app/(check-in)/check-in/[eventId]/offline-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
export function Scanner({ eventId, sessionId, operatorId, sessionLabels, sessionTitle, mode = "staff" }: { eventId: string; sessionId: string; operatorId: string; sessionLabels: Record<string, string>; sessionTitle: string; mode?: "staff" | "kiosk" }) {
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
  const codeInput = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [recent, setRecent] = useState<{ id: string; name: string; time: string } | null>(null);
  const [undoing, setUndoing] = useState(false);

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
    // Kiosk results always clear so the next attendee never sees them; staff success/queued results clear quickly.
    if (!result || overrideCode || (!kiosk && result.kind !== "success" && result.kind !== "queued")) return;
    const timer = window.setTimeout(() => {
      if (!kiosk && result.kind === "success" && result.person) setRecent({ id: result.person.id, name: result.person.name, time: result.time ?? "" });
      setResultState(null);
    }, kiosk ? 5000 : 2500);
    return () => window.clearTimeout(timer);
  }, [kiosk, result, overrideCode]);

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

  const soundOff = useSyncExternalStore(subscribeMuted, isMuted, () => false);

  function closeResult() {
    if (!kiosk && result?.kind === "success" && result.person) setRecent({ id: result.person.id, name: result.person.name, time: result.time ?? "" });
    setResultState(null);
    setOverrideCode("");
    codeInput.current?.focus();
  }

  return <section aria-label="สแกนเช็คชื่อ" className="flex flex-col gap-3">
    <div className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-black", kiosk ? "aspect-square" : "aspect-[4/3]")}>
      {camera ? <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" />
        : <Button type="button" variant="secondary" size="lg" className="relative z-10 h-12" onClick={() => { setCameraError(""); setCamera(true); }}><CameraIcon data-icon="inline-start" aria-hidden="true" />เปิดกล้องเพื่อสแกน</Button>}
      <span aria-hidden="true" className="pointer-events-none absolute inset-[16%]">
        <span className="absolute left-0 top-0 size-10 rounded-tl-2xl border-l-4 border-t-4 border-primary" />
        <span className="absolute right-0 top-0 size-10 rounded-tr-2xl border-r-4 border-t-4 border-primary" />
        <span className="absolute bottom-0 left-0 size-10 rounded-bl-2xl border-b-4 border-l-4 border-primary" />
        <span className="absolute bottom-0 right-0 size-10 rounded-br-2xl border-b-4 border-r-4 border-primary" />
        {camera && <span className="absolute inset-x-[8%] top-1/2 h-0.5 bg-primary/80 shadow-[0_0_12px_var(--primary)] motion-safe:animate-pulse" />}
      </span>
      {(!online || pending > 0) && <div role="status" className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-950/85 px-3 py-2 text-xs font-semibold text-amber-200">
        <WifiOffIcon className="size-4 shrink-0" aria-hidden="true" /><span className="flex-1">{online ? "" : "เน็ตหลุด · "}เก็บไว้ในเครื่อง {pending} รายการ รอ sync</span>
        {!kiosk && pending > 0 && <button type="button" disabled={!online} onClick={() => void sync(true)} className="underline underline-offset-2 disabled:opacity-50">ลองใหม่</button>}
      </div>}
      {camera && <Button type="button" variant="secondary" size="sm" className="absolute bottom-3 right-3 z-10" onClick={() => setCamera(false)}>ปิดกล้อง</Button>}
    </div>
    <p className="text-center text-sm text-muted-foreground">{kiosk ? "ส่อง QR จากหน้าสถานะของคุณให้อยู่ในกรอบ" : "ส่อง QR ให้อยู่ในกรอบ · หรือยิงด้วยเครื่องสแกน"}</p>
    {cameraError && <p role="alert" className="rounded-lg border border-red-400/60 bg-red-500/15 px-3 py-2 text-sm text-red-200">{cameraError}</p>}

    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      {!kiosk && <div className="flex gap-2">
        <button type="button" onClick={() => codeInput.current?.focus()} className={cn("flex h-11 flex-1 items-center gap-2 rounded-lg px-3 text-sm font-semibold", inputFocused ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground")}>
          <ScanBarcodeIcon className="size-4" aria-hidden="true" />{inputFocused ? "เครื่องยิงพร้อม" : "แตะเพื่อใช้เครื่องยิง"}
        </button>
        <button type="button" aria-pressed={!soundOff} onClick={() => setMuted(!soundOff)} className="flex h-11 items-center gap-2 rounded-lg bg-muted/60 px-3 text-sm font-semibold">
          {soundOff ? <VolumeXIcon className="size-4" aria-hidden="true" /> : <Volume2Icon className="size-4" aria-hidden="true" />}เสียงเตือน {soundOff ? "ปิด" : "เปิด"}
        </button>
      </div>}
      <form action={checkInCodeForm.bind(null, eventId, sessionId)} className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit(code, "scanner"); }}>
        <label htmlFor="scan-code" className="sr-only">เครื่องยิง / พิมพ์รหัส QR</label>
        <div className="relative flex-1">
          <KeyboardIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input ref={codeInput} id="scan-code" name="code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} placeholder="ยิงหรือพิมพ์รหัส QR" autoComplete="off" className="h-12 pl-9 text-base" />
        </div>
        <Button type="submit" size="lg" className="h-12 px-5">เช็ค</Button>
      </form>
      {recent && !result && <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
        <CheckIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-semibold">{recent.name}</span><span className="text-xs text-muted-foreground">เพิ่งเช็ค {recent.time}</span></span>
        <Button type="button" variant="outline" size="sm" disabled={undoing} onClick={async () => { setUndoing(true); try { await undoCheckIn(eventId, sessionId, recent.id); setRecent(null); } finally { setUndoing(false); } }}><Undo2Icon data-icon="inline-start" aria-hidden="true" />เอาออก</Button>
      </div>}
      {!kiosk && (pending > 0 || needsReview > 0) && <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">ค้างในเครื่อง {pending} รายการ{needsReview ? ` (ต้องตรวจสอบ ${needsReview})` : ""}</span>
        {needsReview > 0 && <Button type="button" size="sm" variant="destructive" onClick={async () => { if (!window.confirm(`ยืนยันลบ ${needsReview} รายการที่ตรวจไม่ผ่าน? การลบนี้กู้คืนไม่ได้และไม่ได้เช็คชื่อให้`)) return; const removed = await discardRejectedScans(operatorId); setNeedsReview(0); setReviewItems([]); await refreshPending(); setResult({ kind: "error", message: `ลบ ${removed} รายการที่ตรวจไม่ผ่านจากเครื่องแล้ว (ไม่ได้เช็คชื่อ)` }); }}>ลบรายการที่ตรวจไม่ผ่าน</Button>}
      </div>}
      {kiosk && (!online || pending > 0) && <p className="text-sm text-muted-foreground">{online ? "" : "ออฟไลน์ · "}รอส่งข้อมูล {pending} รายการ กรุณาแจ้งเจ้าหน้าที่</p>}
      {!kiosk && reviewItems.length > 0 && <section aria-label="รายการที่ต้องตรวจสอบ" className="rounded-lg border border-red-400/60 p-3 text-sm">
        <h3 className="font-semibold text-red-200">ต้องตรวจสอบ — ยังไม่ได้เช็คชื่อ</h3>
        <ul className="mt-2 flex flex-col gap-1">{reviewItems.map((item) => <li key={item.id} className="flex flex-col border-t pt-1 first:border-t-0 first:pt-0"><span>{reviewTime.format(item.queuedAt)} · {sessionLabels[item.sessionId] ?? "รอบที่ถูกลบแล้ว"}</span><span className="text-xs text-muted-foreground">{item.message}</span></li>)}</ul>
      </section>}
    </div>

    {result && <ResultSheet result={result} kiosk={kiosk} sessionTitle={sessionTitle} onClose={closeResult}>
      {overrideCode ? <form className="flex flex-col gap-2 text-left" onSubmit={(event) => { event.preventDefault(); void submitOverride(); }}>
        <label htmlFor="override-note" className="text-sm font-semibold">อนุญาตเป็นกรณีพิเศษ (บันทึกเหตุผลลง audit log)</label>
        <div className="flex gap-2"><Input id="override-note" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} maxLength={500} placeholder="เช่น ผู้บริหารเข้าร่วมแทน" required minLength={3} className="h-11 border-slate-300 bg-white text-slate-900" /><Button type="submit" className="h-11 bg-amber-600 text-white hover:bg-amber-700">อนุญาต</Button></div>
      </form> : null}
    </ResultSheet>}
  </section>;
}

const tones = {
  success: { icon: CheckIcon, ring: "bg-emerald-100 text-emerald-700", title: "text-emerald-700", label: "เช็คชื่อสำเร็จ" },
  duplicate: { icon: CopyCheckIcon, ring: "bg-amber-100 text-amber-700", title: "text-amber-700", label: "เช็คซ้ำ · รอบนี้เช็คไปแล้ว" },
  "wrong-day": { icon: CalendarXIcon, ring: "bg-amber-100 text-amber-700", title: "text-amber-700", label: "ไม่ได้ลงทะเบียนวันนี้" },
  queued: { icon: CloudOffIcon, ring: "bg-slate-200 text-slate-700", title: "text-slate-700", label: "บันทึกไว้ในเครื่อง" },
  error: { icon: LockIcon, ring: "bg-red-100 text-red-700", title: "text-red-700", label: "เช็คชื่อไม่ได้" },
} as const;

/** Result as a bottom sheet (mockup B): success clears itself, anything that needs attention waits for "ปิด". */
function ResultSheet({ result, kiosk, sessionTitle, onClose, children }: { result: DisplayResult; kiosk: boolean; sessionTitle: string; onClose: () => void; children?: React.ReactNode }) {
  const tone = result.kind === "success" || result.kind === "duplicate" || result.kind === "wrong-day" || result.kind === "queued" ? tones[result.kind] : tones.error;
  const Icon = tone.icon;
  const person = "person" in result ? result.person : undefined;
  const count = "count" in result ? result.count : undefined;
  const time = "time" in result ? result.time : undefined;
  const override = result.kind === "success" && result.message.startsWith("อนุญาตเป็นกรณีพิเศษ");
  const autoClose = kiosk || result.kind === "success" || result.kind === "queued";
  // Sync summaries reuse the sheet without a person; then the message itself is the headline.
  const title = !person && result.kind === "success" ? result.message : override ? "อนุญาตกรณีพิเศษแล้ว" : tone.label;
  const subtitle = person && result.kind === "success" ? [sessionTitle, time].filter(Boolean).join(" · ") : !person && result.kind === "success" ? "" : result.message;
  const rows: [string, string][] = person ? [
    ["วันที่ลงทะเบียนไว้", person.days],
    ...(result.kind === "wrong-day" ? [["รอบที่กำลังเช็ค", sessionTitle] as [string, string]] : []),
    ...(count && !kiosk ? [["ยอดรอบนี้", `${count.checked.toLocaleString("th-TH")} / ${count.expected.toLocaleString("th-TH")}`] as [string, string]] : []),
    ...(result.kind === "success" && result.message.includes("รอบที่") ? [["หลักสูตร", result.message.split(" · ").slice(1).join(" · ")] as [string, string]] : []),
  ] : [];

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="scan-result-title" aria-describedby="scan-result-subtitle" onClick={(event) => event.stopPropagation()}
      className="flex max-h-[90svh] w-full max-w-lg flex-col items-center gap-3 overflow-y-auto rounded-t-3xl bg-white px-5 pb-6 pt-3 text-center text-slate-900 shadow-2xl">
      <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-slate-200" />
      <span className={cn("mt-2 flex size-20 items-center justify-center rounded-full", tone.ring)}><Icon className="size-10" aria-hidden="true" /></span>
      <h2 id="scan-result-title" className={cn("font-heading font-bold", kiosk ? "text-3xl" : "text-2xl", tone.title)}>{title}</h2>
      {subtitle && <p id="scan-result-subtitle" className="text-sm text-slate-600">{subtitle}</p>}
      {person && <div className="flex flex-col"><strong className={cn("font-heading", kiosk ? "text-4xl" : "text-3xl")}>{person.name}</strong>{person.detail && <span className="text-sm text-slate-500">{person.detail}</span>}</div>}
      {rows.length > 0 && <dl className="w-full divide-y divide-slate-200 rounded-xl bg-slate-50 px-4 text-sm">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl>}
      {children && <div className="w-full">{children}</div>}
      {result.kind === "wrong-day" && !children && !kiosk && <p className="text-sm text-slate-600">ทางเลือก: ให้ผู้จัดเพิ่มวันให้ก่อน แล้วสแกนใหม่</p>}
      <Button type="button" size="lg" autoFocus onClick={onClose} className={cn("mt-1 h-14 w-full text-lg text-white", result.kind === "success" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-slate-900 hover:bg-slate-800")}>{result.kind === "success" ? "สแกนคนถัดไป" : "ปิด"}</Button>
      <p className="text-xs text-slate-500">{autoClose ? `กลับไปสแกนอัตโนมัติใน ${kiosk ? 5 : 2} วินาที` : "ต้องกดปิดเอง — ไม่ปิดอัตโนมัติ"}</p>
    </div>
  </div>;
}
