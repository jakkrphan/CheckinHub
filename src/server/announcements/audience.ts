import type { NotificationChannel, RegistrantStatus } from "@prisma/client";

// Who an announcement reaches and on which channel (kept free of Next.js/database imports so it can be unit-tested).

/** Statuses an organizer can address. Rejected and cancelled people are no longer part of the event. */
export const AUDIENCE_STATUSES = ["APPROVED", "PENDING", "WAITLISTED"] as const satisfies readonly RegistrantStatus[];
export type AudienceStatus = (typeof AUDIENCE_STATUSES)[number];

export const audienceLabels: Record<AudienceStatus, string> = { APPROVED: "อนุมัติแล้ว", PENDING: "รออนุมัติ", WAITLISTED: "อยู่ในคิว" };

export const SUBJECT_MAX = 120;
export const BODY_MAX = 2000;
/** Per event, so a mistake cannot flood people (or burn the LINE OA's monthly quota). */
export const DAILY_LIMIT = 5;

type Person = { email: string | null; lineUserId: string | null; notifyVia: NotificationChannel };

/**
 * The person's own choice, like status messages: LINE when they chose it and connected, otherwise email.
 * BOTH (older registrations) gets both. Nobody when there is no email and LINE cannot reach them.
 */
export function channelsFor(person: Person, lineOn: boolean) {
  const line = lineOn && !!person.lineUserId && (person.notifyVia !== "EMAIL" || !person.email);
  const email = !!person.email && (!line || person.notifyVia === "BOTH");
  return { line, email };
}

export type Reach = { people: number; line: number; email: number; unreachable: number };

export function countReach(people: Person[], lineOn: boolean): Reach {
  const reach: Reach = { people: people.length, line: 0, email: 0, unreachable: 0 };
  for (const person of people) {
    const { line, email } = channelsFor(person, lineOn);
    if (line) reach.line++;
    if (email) reach.email++;
    if (!line && !email) reach.unreachable++;
  }
  return reach;
}

/** The form's audience checkboxes, keeping only known statuses. */
export function parseAudience(values: unknown[]): AudienceStatus[] {
  return AUDIENCE_STATUSES.filter((status) => values.includes(status));
}

/** Suggested wording after a whole-course day was added or removed (the spec requires telling the participants). */
export function scheduleChangeDraft(change: "added" | "removed") {
  return {
    subject: change === "added" ? "เพิ่มวันอบรมในหลักสูตร" : "ยกเลิกวันอบรมบางวันในหลักสูตร",
    body: change === "added"
      ? "ผู้จัดได้เพิ่มวันอบรมในหลักสูตรนี้ กรุณาตรวจสอบวันอบรมล่าสุดและสถานะของคุณจากปุ่มด้านล่าง"
      : "ผู้จัดได้ยกเลิกวันอบรมบางวันของหลักสูตรนี้ กรุณาตรวจสอบวันอบรมที่เหลือและสถานะของคุณจากปุ่มด้านล่าง",
  };
}
