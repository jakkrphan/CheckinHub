"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LockKeyholeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const storageKey = (eventId: string) => `kiosk-pin:${eventId}`;

async function digest(eventId: string, pin: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${eventId}:${pin}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPin(eventId: string) {
  try { return sessionStorage.getItem(storageKey(eventId)); } catch { return null; }
}

/**
 * Staff set a PIN before handing the device to attendees. Leaving kiosk mode (and so changing session or
 * seeing staff screens) requires the PIN; the browser back button is held on this page while locked.
 */
export function KioskLock({ eventId, exitHref, children }: { eventId: string; exitHref: string; children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "setup" | "running" | "exit">("loading");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setPhase(readPin(eventId) ? "running" : "setup"));
    return () => cancelAnimationFrame(frame);
  }, [eventId]);

  useEffect(() => {
    if (phase !== "running" && phase !== "exit") return;
    history.pushState(null, "", location.href);
    const hold = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", hold);
    return () => window.removeEventListener("popstate", hold);
  }, [phase]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,8}$/.test(pin)) { setError("PIN ต้องเป็นตัวเลข 4–8 หลัก"); return; }
    if (pin !== confirm) { setError("PIN ทั้งสองช่องไม่ตรงกัน"); return; }
    try { sessionStorage.setItem(storageKey(eventId), await digest(eventId, pin)); } catch { setError("อุปกรณ์นี้เก็บ PIN ไม่ได้ (โหมดส่วนตัว?)"); return; }
    setPin(""); setConfirm(""); setError(""); setPhase("running");
  }

  async function exit(event: FormEvent) {
    event.preventDefault();
    if (attempts >= 5) { setError("ใส่ PIN ผิดหลายครั้ง กรุณารอสักครู่"); return; }
    if (await digest(eventId, pin) !== readPin(eventId)) {
      const next = attempts + 1;
      setAttempts(next);
      setError("PIN ไม่ถูกต้อง");
      if (next >= 5) window.setTimeout(() => { setAttempts(0); setError(""); }, 60_000);
      return;
    }
    try { sessionStorage.removeItem(storageKey(eventId)); } catch { /* already gone */ }
    router.replace(exitHref);
  }

  if (phase === "loading") return null;
  if (phase === "setup") return <form onSubmit={start} className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-2xl border bg-card p-6">
    <div className="flex items-center gap-3"><LockKeyholeIcon className="size-6 text-primary" aria-hidden="true" /><h2 className="font-heading text-xl font-bold">ตั้ง PIN ก่อนเปิดโหมด kiosk</h2></div>
    <p className="text-sm text-muted-foreground">ผู้เข้าอบรมจะสแกน QR ของตัวเองได้เท่านั้น ต้องใช้ PIN นี้เพื่อออกจากโหมด kiosk หรือเปลี่ยนรอบ</p>
    <label className="flex flex-col gap-1 text-sm font-medium">PIN (ตัวเลข 4–8 หลัก)<Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} maxLength={8} required /></label>
    <label className="flex flex-col gap-1 text-sm font-medium">ยืนยัน PIN<Input type="password" inputMode="numeric" autoComplete="off" value={confirm} onChange={(event) => setConfirm(event.target.value)} maxLength={8} required /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" size="lg">เริ่มโหมด kiosk</Button>
  </form>;

  return <>
    {children}
    {phase === "exit" ? <form onSubmit={exit} className="mx-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl border bg-card p-5">
      <label className="flex flex-col gap-1 text-sm font-medium">PIN เจ้าหน้าที่<Input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(event) => setPin(event.target.value)} maxLength={8} required /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => { setPhase("running"); setPin(""); setError(""); }}>ยกเลิก</Button><Button type="submit" variant="outline">ออกจากโหมด kiosk</Button></div>
    </form> : <button type="button" onClick={() => setPhase("exit")} className="mx-auto text-xs text-muted-foreground underline-offset-4 hover:underline">สำหรับเจ้าหน้าที่</button>}
  </>;
}
