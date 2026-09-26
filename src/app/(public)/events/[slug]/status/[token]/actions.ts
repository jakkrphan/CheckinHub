"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { changeOwnDays } from "@/server/registrations/day-change";
import { cancelOwnRegistration } from "@/server/registrations/lifecycle";
import { updateOwnAnswers } from "@/server/registrations/self-edit";

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

export async function updateOwnAnswersAction(slug: string, token: string, formData: FormData) {
  const result = await updateOwnAnswers(slug, token, formData);
  if (result === "not-found") notFound();
  if (result === "invalid") redirect(`/events/${slug}/status/${token}/edit?error=invalid`);
  if (result === "closed") redirect(`/events/${slug}/status/${token}/edit`);
  revalidatePath(`/events/${slug}/status/${token}`);
  redirect(`/events/${slug}/status/${token}?updated=${result === "saved" ? "1" : "0"}`);
}

export async function changeOwnDaysAction(slug: string, token: string, formData: FormData) {
  const result = await changeOwnDays(slug, token, formData.getAll("dayId"));
  if (result === "not-found") notFound();
  if (result !== "saved" && result !== "unchanged") redirect(`/events/${slug}/status/${token}/days?error=${result}`);
  revalidatePath(`/events/${slug}`);
  revalidatePath(`/events/${slug}/status/${token}`);
  redirect(`/events/${slug}/status/${token}?days=${result === "saved" ? "1" : "0"}`);
}
