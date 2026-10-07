"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { BODY_MAX, parseAudience, SUBJECT_MAX } from "@/server/announcements/audience";
import { sendAnnouncement } from "@/server/announcements/announcements";
import { requireEventAccess } from "@/server/authorization/event";

/** "ส่งประกาศ": queues the message to everyone in the chosen statuses, each on their own channel. */
export async function postAnnouncement(eventId: string, formData: FormData) {
  const { user, event } = await requireEventAccess(eventId, "manage");
  const page = `/organizer/${eventId}/announcements`;
  if (event.anonymizedAt) redirect(`${page}?result=anonymized`);
  const subject = formData.get("subject")?.toString().replace(/\s+/g, " ").trim() ?? "";
  const body = formData.get("body")?.toString().replace(/\r\n/g, "\n").trim() ?? "";
  const audience = parseAudience(formData.getAll("audience"));
  if (!subject || subject.length > SUBJECT_MAX || !body || body.length > BODY_MAX || !audience.length) redirect(`${page}?result=invalid`);
  const result = await sendAnnouncement({ eventId, authorId: user.id, subject, body, audience });
  if (!result.ok) redirect(`${page}?result=${result.reason}`);
  revalidatePath(page);
  redirect(`${page}?result=sent&line=${result.reach.line}&email=${result.reach.email}&unreachable=${result.reach.unreachable}`);
}
