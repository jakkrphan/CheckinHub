"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarXIcon, CameraIcon, CheckIcon, CloudOffIcon, CopyCheckIcon, KeyboardIcon, LockIcon, RefreshCwIcon, ScanBarcodeIcon, Undo2Icon, WifiOffIcon } from "lucide-react";

import { checkInCode, checkInCodeForm, overrideCheckIn, undoCheckIn, type ScanResult } from "@/app/(check-in)/check-in/[eventId]/actions";
import { discardRejectedScans, listReviewScans, otherOperatorScanCount, pendingScanCount, queueScan, syncQueuedScans, type ReviewScan } from "@/app/(check-in)/check-in/[eventId]/offline-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}

/** For values fixed for the page's lifetime (e.g. secure context): read once on the client, never re-notified. */
const subscribeNever = () => () => {};

type DisplayResult = ScanResult | { kind: "queued"; message: string; canOverride?: undefined };

/** Desktop layout (mockup B v3 checkin-desktop): results render inline instead of as a bottom sheet. */
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia("(min-width: 1024px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

/** How this device reads QR codes; defaults to a USB/Bluetooth scanner and is remembered per device. */
type InputMode = "scanner" | "camera";
const MODE_KEY = "checkin-input-mode";
const modeListeners = new Set<() => void>();
function readMode(): InputMode {
  try { return localStorage.getItem(MODE_KEY) === "camera" ? "camera" : "scanner"; } catch { return "scanner"; }
}
function writeMode(mode: InputMode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage may be blocked; the choice then lasts for this page only */ }
  for (const listener of modeListeners) listener();
}
function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

/** A scanner can fire twice for one QR: true when `value` repeats the last scan within 3 seconds, otherwise records it. */
/**
 * Scanners that send no Enter: a hardware scanner types the whole code in one burst (a few ms per character),
 * so a burst that goes quiet is submitted on its own. Anything typed at human speed still waits for Enter.
 */
const SCANNER_KEY_GAP_MS = 60;
const SCANNER_IDLE_MS = 250;
const SCANNER_MIN_LENGTH = 8;
function isScannerBurst(state: { at: number; burst: boolean }, previous: string, next: string) {
  const now = Date.now();
  state.burst = next.length > previous.length && (previous === "" || (state.burst && now - state.at < SCANNER_KEY_GAP_MS));
  state.at = now;
  return state.burst && next.trim().length >= SCANNER_MIN_LENGTH;
}

function isRepeatScan(last: { code: string; at: number }, value: string) {
  const now = Date.now();
  if (last.code === value && now - last.at < 3000) return true;
  last.code = value;
  last.at = now;
  return false;
}

const reviewTime =new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/**
 * `kiosk` mode is for attendees scanning their own QR: no override, no staff tools, and the result clears itself
 * so the next person never sees the previous one. `allowCamera` false (admin switch) keeps every device on the
 * scanner/typed-code input and hides the mode choice.
 */
export function Scanner({ eventId, sessionId, operatorId, sessionLabels, sessionTitle, station = null, mode = "staff", allowCamera = true }: { eventId: string; sessionId: string; operatorId: string; sessionLabels: Record<string, string>; sessionTitle: string; station?: string | null; mode?: "staff" | "kiosk"; allowCamera?: boolean }) {
  const kiosk = mode === "kiosk";
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const scans = useRef<Promise<void>>(Promise.resolve());
  const keys = useRef({ at: 0, burst: false });
  const autoSubmit = useRef<number | undefined>(undefined);
  const last = useRef({ code: "", at: 0 });
  const inputMode = useSyncExternalStore(subscribeMode, readMode, () => "scanner" as InputMode);
  const camera = allowCamera && inputMode === "camera";
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [result, setResultState] = useState<DisplayResult | null>(null);
  const [overrideCode, setOverrideCode] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewScan[]>([]);
  const [cameraError, setCameraError] = useState("");
  // Browsers expose the camera only on HTTPS or localhost; over http://<ip> navigator.mediaDevices is missing.
  const cameraSupported = useSyncExternalStore(subscribeNever, () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia, () => true);
  const cameraMessage = cameraSupported ? cameraError : "เบราว์เซอร์เปิดกล้องได้เฉพาะหน้าเว็บ HTTPS หรือ localhost — หน้านี้เปิดผ่าน http:// จึงใช้กล้องไม่ได้ ใช้เครื่องยิง QR แทน หรือเปิดผ่าน HTTPS";
  const [pending, setPending] = useState(0);
  const [needsReview, setNeedsReview] = useState(0);
  const [otherPending, setOtherPending] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const syncing = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [recent, setRecent] = useState<{ id: string; name: string; time: string } | null>(null);
  const [undoing, setUndoing] = useState(false);

  function setResult(next: DisplayResult | null, scannedCode = "") {
    setResultState(next);
    // Results are visual only (no sound or vibration, by request): the colour-coded sheet carries the outcome.
    setOverrideCode(!kiosk && next?.kind === "wrong-day" && next.canOverride ? scannedCode : "");
  }

  async function refreshPending() {
    setPending(await pendingScanCount(operatorId));
    setOtherPending(await otherOperatorScanCount(operatorId));
  }
  async function refreshReview() { setReviewItems(await listReviewScans(operatorId)); }

  async function queue(value: string, clientEventId?: string) {
    try {
      await queueScan(operatorId, eventId, sessionId, value, clientEventId);
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
    window.clearTimeout(autoSubmit.current);
    if (!value) return;
    // Clear right away so the next scan never appends to this one, even while it is still being saved.
    setCode("");
    if (value.length > 200) { setResult({ kind: "invalid", message: "รหัส QR ยาวเกินไป" }); return; }
    if (isRepeatScan(last.current, value)) return;
    // Scans that arrive while an earlier one is saving wait their turn instead of being dropped.
    scans.current = scans.current.then(() => record(value, source));
  }

  async function record(value: string, source: "camera" | "scanner") {
    busy.current = true;
    // The same id goes into the queue if the request fails, so a save whose answer was lost is not counted twice.
    const clientEventId = crypto.randomUUID();
    try {
      if (!navigator.onLine) await queue(value, clientEventId);
      else setResult(await checkInCode(eventId, sessionId, value, clientEventId, undefined, kiosk ? "kiosk" : source), value);
    } catch {
      await queue(value, clientEventId);
    } finally { busy.current = false; }
  }

  function changeCode(next: string) {
    const burst = isScannerBurst(keys.current, code, next);
    setCode(next);
    window.clearTimeout(autoSubmit.current);
    if (burst) autoSubmit.current = window.setTimeout(() => void submit(next, camera ? "camera" : "scanner"), SCANNER_IDLE_MS);
  }

  useEffect(() => () => window.clearTimeout(autoSubmit.current), []);

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
      if (!camera) codeInput.current?.focus();
    }, kiosk ? 5000 : 2500);
    return () => window.clearTimeout(timer);
  }, [kiosk, result, overrideCode, camera]);

  useEffect(() => {
    // Unsynced scans live only on this device; warn before the tab is closed or navigated away.
    if (pending === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  useEffect(() => {
    void pendingScanCount(operatorId).then((count) => { setPending(count); void otherOperatorScanCount(operatorId).then(setOtherPending); void refreshReview(); void sync(); }).catch(() => setResult({ kind: "error", message: "เปิดคิวออฟไลน์ไม่ได้ กรุณาเช็คชื่อขณะออนไลน์" }));
    const onOnline = () => { void sync(); };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void sync(); }, 15000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(timer); };
    // Queue functions do not depend on the current input state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, sessionId, operatorId]);

  useEffect(() => {
    if (!camera || !cameraSupported || !video.current) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserQRCodeReader();
    reader.decodeFromVideoDevice(undefined, video.current, (scan) => {
      if (!cancelled && scan) void submit(scan.getText(), "camera");
    }).then((current) => { if (cancelled) current.stop(); else controls = current; }).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError" ? "ไม่ได้รับอนุญาตให้ใช้กล้อง — กดรูปกล้อง/แม่กุญแจที่แถบที่อยู่ของเบราว์เซอร์ อนุญาตกล้อง แล้วกด “ลองอีกครั้ง”"
        : name === "NotFoundError" || name === "OverconstrainedError" ? "ไม่พบกล้องในเครื่องนี้ — ใช้เครื่องยิง QR แทน"
        : name === "NotReadableError" || name === "AbortError" ? "กล้องถูกใช้อยู่โดยโปรแกรมหรือแท็บอื่น ปิดโปรแกรมนั้นแล้วกด “ลองอีกครั้ง”"
        : "เปิดกล้องไม่ได้ กรุณาอนุญาตสิทธิ์กล้องในเบราว์เซอร์ หรือสลับไปใช้เครื่องยิง QR",
      );
    });
    return () => { cancelled = true; controls?.stop(); };
    // Camera lifecycle is tied to the selected session, the input mode and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, cameraSupported, cameraAttempt, eventId, sessionId]);

  useEffect(() => {
    // autoFocus can land before hydration, so React never saw the focus event; sync the "ready" state once mounted.
    const frame = requestAnimationFrame(() => setInputFocused(document.activeElement === codeInput.current));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function undoFromResult(personId: string) {
    setUndoing(true);
    try { await undoCheckIn(eventId, sessionId, personId); setResultState(null); setRecent(null); last.current = { code: "", at: 0 }; } finally { setUndoing(false); codeInput.current?.focus(); }
  }

  function chooseMode(next: InputMode) {
    setCameraError("");
    writeMode(next);
    if (next === "scanner") window.setTimeout(() => codeInput.current?.focus(), 0);
  }

  function closeResult() {
    if (!kiosk && result?.kind === "success" && result.person) setRecent({ id: result.person.id, name: result.person.name, time: result.time ?? "" });
    setResultState(null);
    setOverrideCode("");
    codeInput.current?.focus();
  }

  const offline = (!online || pending > 0) && <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
    <WifiOffIcon className="size-4 shrink-0" aria-hidden="true" /><span className="flex-1">{online ? "" : "เน็ตหลุด · "}เก็บไว้ในเครื่อง {pending} รายการ รอ sync</span>
    {!kiosk && pending > 0 && <button type="button" disabled={!online} onClick={() => void sync(true)} className="min-h-8 underline underline-offset-2 disabled:opacity-50">ลองใหม่</button>}
  </div>;

  const overrideForm = overrideCode ? <form className="flex flex-col gap-2 text-left" onSubmit={(event) => { event.preventDefault(); void submitOverride(); }}>
    <label htmlFor="override-note" className="text-sm font-semibold">อนุญาตเป็นกรณีพิเศษ (บันทึกเหตุผลลง audit log)</label>
    <div className="flex gap-2"><Input id="override-note" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} maxLength={500} placeholder="เช่น ผู้บริหารเข้าร่วมแทน" required minLength={3} className="h-11 border-slate-300 bg-white text-slate-900" /><Button type="submit" className="h-11 bg-amber-600 text-white hover:bg-amber-700">อนุญาต</Button></div>
  </form> : null;

  return <section aria-label="สแกนเช็คชื่อ" className="flex flex-col gap-3">
    {result && desktop && !kiosk && <ResultCard result={result} sessionTitle={station ? `${sessionTitle} · ${station}` : sessionTitle} onClose={closeResult} onUndo={undoFromResult} undoing={undoing}>{overrideForm}</ResultCard>}
    {!kiosk && allowCamera && <div role="radiogroup" aria-label="วิธีสแกน QR" className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1">
      {([["scanner", "เครื่องยิง QR", ScanBarcodeIcon], ["camera", "กล้อง", CameraIcon]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="radio" aria-checked={inputMode === value} onClick={() => chooseMode(value)}
        className={cn("flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors", inputMode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
        <Icon className="size-4" aria-hidden="true" />{label}
      </button>)}
    </div>}
    {offline}
    {!kiosk && otherPending > 0 && <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
      <CloudOffIcon className="mt-px size-4 shrink-0" aria-hidden="true" />
      <span>เครื่องนี้มีรายการสแกนของบัญชีเจ้าหน้าที่อื่นค้างอยู่ {otherPending} รายการ ยังไม่ได้บันทึก — ให้เจ้าของบัญชีนั้นเข้าสู่ระบบบนเครื่องนี้ขณะออนไลน์เพื่อซิงก์</span>
    </div>}

    {/* Camera mode on tablets and short landscape phones: camera and controls side by side so the code input stays on screen. */}
    <div className={cn("grid grid-cols-1 items-start gap-3", camera && "md:grid-cols-2 [@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2")}>
    {camera && <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-black [@media(orientation:landscape)_and_(max-height:540px)]:aspect-auto [@media(orientation:landscape)_and_(max-height:540px)]:h-[55svh]", kiosk ? "aspect-square" : "aspect-[4/3]")}>
        <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-[16%]">
          <span className="absolute left-0 top-0 size-10 rounded-tl-2xl border-l-4 border-t-4 border-primary" />
          <span className="absolute right-0 top-0 size-10 rounded-tr-2xl border-r-4 border-t-4 border-primary" />
          <span className="absolute bottom-0 left-0 size-10 rounded-bl-2xl border-b-4 border-l-4 border-primary" />
          <span className="absolute bottom-0 right-0 size-10 rounded-br-2xl border-b-4 border-r-4 border-primary" />
          {!cameraMessage && <span className="absolute inset-x-[8%] top-1/2 h-0.5 bg-primary/80 shadow-[0_0_12px_var(--primary)] motion-safe:animate-pulse" />}
        </span>
      </div>
      <p className="text-center text-sm text-muted-foreground">{kiosk ? "ส่อง QR จากหน้าสถานะของคุณให้อยู่ในกรอบ" : "ส่อง QR ให้อยู่ในกรอบ"}</p>
      {cameraMessage && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"><span className="flex-1">{cameraMessage}</span>{cameraSupported && <Button type="button" variant="secondary" size="sm" className="h-9" onClick={() => { setCameraError(""); setCameraAttempt((attempt) => attempt + 1); }}><RefreshCwIcon data-icon="inline-start" aria-hidden="true" />ลองอีกครั้ง</Button>}</div>}
    </div>}

    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      {!camera && <button type="button" onClick={() => codeInput.current?.focus()} aria-live="polite"
        className={cn("flex min-h-24 w-full items-center gap-4 rounded-xl border-2 px-4 py-4 text-left transition-colors", inputFocused ? "border-primary bg-primary/10" : "border-amber-400 bg-amber-50")}>
        <ScanBarcodeIcon className={cn("size-10 shrink-0", inputFocused ? "text-primary" : "text-amber-700")} aria-hidden="true" />
        <span className="flex flex-col gap-0.5">
          <span className={cn("font-heading text-lg font-bold", inputFocused ? "text-primary" : "text-amber-900")}>{inputFocused ? "พร้อมรับจากเครื่องยิง" : "แตะที่นี่ให้เครื่องยิงพร้อม"}</span>
          <span className="text-sm text-muted-foreground">{inputFocused ? "ยิง QR ได้เลย ระบบเช็คชื่อให้ทันที" : "ช่องรับรหัสไม่ได้เลือกอยู่ เครื่องยิงจะพิมพ์ไม่เข้า"}</span>
        </span>
      </button>}
      <form action={checkInCodeForm.bind(null, eventId, sessionId)} className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit(code, camera ? "camera" : "scanner"); }}>
        <label htmlFor="scan-code" className="sr-only">เครื่องยิง / พิมพ์รหัส QR</label>
        <div className="relative flex-1">
          <KeyboardIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input ref={codeInput} id="scan-code" name="code" autoFocus={!camera} value={code} onChange={(event) => changeCode(event.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} placeholder={camera ? "หรือพิมพ์รหัส QR" : "ยิงหรือพิมพ์รหัส QR"} autoComplete="off" className="h-12 pl-9 text-base" />
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
        <h3 className="font-semibold text-red-700">ต้องตรวจสอบ — ยังไม่ได้เช็คชื่อ</h3>
        <ul className="mt-2 flex flex-col gap-1">{reviewItems.map((item) => <li key={item.id} className="flex flex-col border-t pt-1 first:border-t-0 first:pt-0"><span>{reviewTime.format(item.queuedAt)} · {sessionLabels[item.sessionId] ?? "รอบที่ถูกลบแล้ว"}</span><span className="text-xs text-muted-foreground">{item.message}</span></li>)}</ul>
      </section>}
    </div>
    </div>

    {result && (!desktop || kiosk) && <ResultSheet result={result} kiosk={kiosk} keepInputFocus={!camera} sessionTitle={station && !kiosk ? `${sessionTitle} · ${station}` : sessionTitle} onClose={closeResult}>{overrideForm}</ResultSheet>}
  </section>;
}

const tones = {
  success: { icon: CheckIcon, ring: "bg-emerald-100 text-emerald-700", title: "text-emerald-700", label: "เช็คชื่อสำเร็จ" },
  duplicate: { icon: CopyCheckIcon, ring: "bg-amber-100 text-amber-700", title: "text-amber-700", label: "เช็คซ้ำ · รอบนี้เช็คไปแล้ว" },
  "wrong-day": { icon: CalendarXIcon, ring: "bg-amber-100 text-amber-700", title: "text-amber-700", label: "ไม่ได้ลงทะเบียนวันนี้" },
  queued: { icon: CloudOffIcon, ring: "bg-slate-200 text-slate-700", title: "text-slate-700", label: "บันทึกไว้ในเครื่อง" },
  error: { icon: LockIcon, ring: "bg-red-100 text-red-700", title: "text-red-700", label: "เช็คชื่อไม่ได้" },
} as const;

function resultRows(result: DisplayResult, sessionTitle: string, kiosk: boolean): [string, string][] {
  const person = "person" in result ? result.person : undefined;
  const count = "count" in result ? result.count : undefined;
  if (!person) return [];
  return [
    ["วันที่ลงทะเบียนไว้", person.days],
    ...(result.kind === "wrong-day" ? [["รอบที่กำลังเช็ค", sessionTitle] as [string, string]] : []),
    ...(count && !kiosk ? [["ยอดรอบนี้", `${count.checked.toLocaleString("th-TH")} / ${count.expected.toLocaleString("th-TH")}`] as [string, string]] : []),
    ...("progress" in result && result.progress ? [["ความต่อเนื่อง", `รอบที่ ${result.progress.session} จาก ${result.progress.total} · เข้าแล้ว ${result.progress.attended} รอบ`] as [string, string]] : []),
  ];
}

const cardTone = {
  success: "border-emerald-600", duplicate: "border-amber-500", "wrong-day": "border-amber-500", queued: "border-slate-400", error: "border-red-500",
} as const;

/** Desktop result (mockup B v3 checkin-desktop-ok): an inline card that leaves the scanner input focused. */
function ResultCard({ result, sessionTitle, onClose, onUndo, undoing, children }: { result: DisplayResult; sessionTitle: string; onClose: () => void; onUndo: (personId: string) => void; undoing: boolean; children?: React.ReactNode }) {
  const kind = result.kind === "success" || result.kind === "duplicate" || result.kind === "wrong-day" || result.kind === "queued" ? result.kind : "error";
  const tone = tones[kind];
  const Icon = tone.icon;
  const person = "person" in result ? result.person : undefined;
  const time = "time" in result ? result.time : undefined;
  const override = result.kind === "success" && result.message.startsWith("อนุญาตเป็นกรณีพิเศษ");
  const autoClose = result.kind === "success" || result.kind === "queued";
  const title = !person && result.kind === "success" ? result.message : override ? "อนุญาตกรณีพิเศษแล้ว" : tone.label;
  const subtitle = person && result.kind === "success" ? [sessionTitle, time].filter(Boolean).join(" · ") : !person && result.kind === "success" ? "" : result.message;
  const rows = resultRows(result, sessionTitle, false);

  return <div className="flex flex-col gap-2">
    <section role="status" aria-live="assertive" className={cn("flex items-start gap-5 rounded-2xl border-2 bg-white p-5 text-slate-900 shadow-sm", cardTone[kind])}>
      <span className={cn("flex size-20 shrink-0 items-center justify-center rounded-full", tone.ring)}><Icon className="size-10" aria-hidden="true" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-3"><strong className={cn("font-heading text-2xl", tone.title)}>{title}</strong>{subtitle && <span className="text-sm text-slate-600">{subtitle}</span>}</p>
        {person && <p className="flex flex-wrap items-baseline gap-x-3"><strong className="font-heading text-3xl">{person.name}</strong>{person.detail && <span className="text-slate-500">{person.detail}</span>}</p>}
        {rows.length > 0 && <dl className="grid gap-x-8 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-t border-slate-200 py-2"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl>}
        {children}
      </div>
      <div className="flex w-52 shrink-0 flex-col items-stretch gap-2 text-center">
        {result.kind === "success" && person && !override && <>
          <Button type="button" variant="outline" className="h-11 border-slate-300 bg-white text-slate-900 hover:bg-slate-50" disabled={undoing} onClick={() => onUndo(person.id)}><Undo2Icon data-icon="inline-start" aria-hidden="true" />ยกเลิกการเช็คนี้</Button>
          <p className="text-xs text-slate-500">ยกเลิกได้ภายใน 10 นาที · ระบบเก็บประวัติว่าใครกดยกเลิก</p>
        </>}
        {!autoClose && <Button type="button" onClick={onClose} className="h-11 bg-slate-900 text-white hover:bg-slate-800">ปิด</Button>}
      </div>
    </section>
    {autoClose && <Countdown key={result.message + (time ?? "")} />}
  </div>;
}

/** Bar that empties over the auto-close delay so staff see when the screen is ready for the next person. */
function Countdown() {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
    <span className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-[width] duration-[2500ms] ease-linear" style={{ width: started ? "0%" : "100%" }} /></span>
    พร้อมรับคนถัดไปอัตโนมัติใน 2 วินาที
  </div>;
}

/** Result as a bottom sheet (mockup B): success clears itself, anything that needs attention waits for "ปิด". */
/**
 * With a hardware scanner the code input keeps focus under the sheet, so the next scan goes straight in (and replaces
 * this result) instead of landing on the close button.
 */
function ResultSheet({ result, kiosk, keepInputFocus, sessionTitle, onClose, children }: { result: DisplayResult; kiosk: boolean; keepInputFocus: boolean; sessionTitle: string; onClose: () => void; children?: React.ReactNode }) {
  const tone = result.kind === "success" || result.kind === "duplicate" || result.kind === "wrong-day" || result.kind === "queued" ? tones[result.kind] : tones.error;
  const Icon = tone.icon;
  const person = "person" in result ? result.person : undefined;
  const time = "time" in result ? result.time : undefined;
  const override = result.kind === "success" && result.message.startsWith("อนุญาตเป็นกรณีพิเศษ");
  const autoClose = kiosk || result.kind === "success" || result.kind === "queued";
  // Sync summaries reuse the sheet without a person; then the message itself is the headline.
  const title = !person && result.kind === "success" ? result.message : override ? "อนุญาตกรณีพิเศษแล้ว" : tone.label;
  const subtitle = person && result.kind === "success" ? [sessionTitle, time].filter(Boolean).join(" · ") : !person && result.kind === "success" ? "" : result.message;
  const rows = resultRows(result, sessionTitle, kiosk);

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
    <div {...(keepInputFocus ? { role: "status", "aria-live": "assertive" as const } : { role: "alertdialog", "aria-modal": true })} aria-labelledby="scan-result-title" aria-describedby="scan-result-subtitle" onClick={(event) => event.stopPropagation()}
      className="flex max-h-[90svh] w-full max-w-lg flex-col items-center gap-3 overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-center text-slate-900 shadow-2xl">
      <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-slate-200" />
      <span className={cn("mt-2 flex size-20 items-center justify-center rounded-full", tone.ring)}><Icon className="size-10" aria-hidden="true" /></span>
      <h2 id="scan-result-title" className={cn("font-heading font-bold", kiosk ? "text-3xl" : "text-2xl", tone.title)}>{title}</h2>
      {subtitle && <p id="scan-result-subtitle" className="text-sm text-slate-600">{subtitle}</p>}
      {person && <div className="flex flex-col"><strong className={cn("font-heading", kiosk ? "text-4xl" : "text-3xl")}>{person.name}</strong>{person.detail && <span className="text-sm text-slate-500">{person.detail}</span>}</div>}
      {rows.length > 0 && <dl className="w-full divide-y divide-slate-200 rounded-xl bg-slate-50 px-4 text-sm">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl>}
      {children && <div className="w-full">{children}</div>}
      {result.kind === "wrong-day" && !children && !kiosk && <p className="text-sm text-slate-600">ทางเลือก: ให้ผู้จัดเพิ่มวันให้ก่อน แล้วสแกนใหม่</p>}
      <Button type="button" size="lg" autoFocus={!keepInputFocus} onClick={onClose} className={cn("mt-1 h-14 w-full text-lg text-white", result.kind === "success" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-slate-900 hover:bg-slate-800")}>{result.kind === "success" ? "สแกนคนถัดไป" : "ปิด"}</Button>
      <p className="text-xs text-slate-500">{autoClose ? `กลับไปสแกนอัตโนมัติใน ${kiosk ? 5 : 2} วินาที` : "ต้องกดปิดเอง — ไม่ปิดอัตโนมัติ"}</p>
    </div>
  </div>;
}
