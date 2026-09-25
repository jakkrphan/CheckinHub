"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const storageKey = (eventId: string) => `checkin-session:${eventId}`;

/** Remembers the last session per event so a reloaded device does not silently fall back to the first session. */
export function SessionMemory({ eventId, sessionId, sessionIds, explicit }: { eventId: string; sessionId: string; sessionIds: string[]; explicit: boolean }) {
  const router = useRouter();

  useEffect(() => {
    try {
      if (explicit) { localStorage.setItem(storageKey(eventId), sessionId); return; }
      const remembered = localStorage.getItem(storageKey(eventId));
      if (remembered && remembered !== sessionId && sessionIds.includes(remembered)) router.replace(`?session=${remembered}`);
      else localStorage.setItem(storageKey(eventId), sessionId);
    } catch {
      // Storage can be unavailable in private mode; the URL still carries the session.
    }
  }, [eventId, sessionId, sessionIds, explicit, router]);

  return null;
}
