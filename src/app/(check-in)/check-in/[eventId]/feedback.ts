"use client";

export type FeedbackTone = "success" | "warning" | "error";

let context: AudioContext | null = null;
const MUTE_KEY = "checkin-sound-muted";
const listeners = new Set<() => void>();

/** Sound preference is per device; vibration always stays on. */
export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setMuted(muted: boolean) {
  try { if (muted) localStorage.setItem(MUTE_KEY, "1"); else localStorage.removeItem(MUTE_KEY); } catch { /* storage may be blocked */ }
  for (const listener of listeners) listener();
}

export function subscribeMuted(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Browsers block audio until a user gesture; call this from the first tap or key press. */
export function unlockAudio() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null;
  }
}

const patterns: Record<FeedbackTone, { tones: [number, number][]; vibrate: number[] }> = {
  success: { tones: [[880, 0.12]], vibrate: [80] },
  warning: { tones: [[520, 0.1], [520, 0.1]], vibrate: [80, 80, 80] },
  error: { tones: [[220, 0.35]], vibrate: [300] },
};

/** Distinct beep + vibration per result so staff can react without reading the screen. */
export function signalResult(tone: FeedbackTone) {
  const pattern = patterns[tone];
  try { navigator.vibrate?.(pattern.vibrate); } catch { /* vibration is optional */ }
  if (!context || context.state !== "running" || isMuted()) return;
  let at = context.currentTime;
  for (const [frequency, duration] of pattern.tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
    at += duration + 0.06;
  }
}
