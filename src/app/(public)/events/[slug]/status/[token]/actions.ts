"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { cancelOwnRegistration } from "@/server/registrations/lifecycle";

export async function cancelRegistration(slug: string, token: string, formData: FormData) {
  if (formData.get("confirm") !== "on") redirect(`/events/${slug}/status/${token}?error=confirm`);
  const eventDayId = formData.get("dayId");
  if (eventDayId !== null && (typeof eventDayId !== "string" || !eventDayId)) notFound();
  const result = await cancelOwnRegistration(slug, token, typeof eventDayId === "string" && eventDayId ? eventDayId : undefined);
  if (result === "not-found") notFound();
  if (result === "already-checked-in") redirect(`/events/${slug}/status/${token}?error=checked-in`);
  if (result === "unavailable") redirect(`/events/${slug}/status/${token}?error=retry`);
  revalidatePath(`/events/${slug}`);
  redirect(`/events/${slug}/status/${token}?cancelled=1`);
}
