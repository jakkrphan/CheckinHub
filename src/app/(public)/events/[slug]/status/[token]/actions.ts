"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requestOwnDeletion } from "@/server/registrations/data-requests";
import { changeOwnDays } from "@/server/registrations/day-change";
import { cancelOwnRegistration } from "@/server/registrations/lifecycle";
import { updateOwnAnswers } from "@/server/registrations/self-edit";
import { isFeatureEnabled } from "@/server/settings/features";

export async function cancelRegistration(slug: string, token: string, formData: FormData) {
  if (!(await isFeatureEnabled("selfCancel"))) redirect(`/events/${slug}/status/${token}?error=disabled`);
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
  if (!(await isFeatureEnabled("selfEdit"))) redirect(`/events/${slug}/status/${token}?error=disabled`);
  const result = await updateOwnAnswers(slug, token, formData);
  if (result.status === "not-found") notFound();
  if (result.status === "invalid") {
    const params = new URLSearchParams({ error: result.formChanged ? "form-changed" : "invalid" });
    if (result.problem.fieldKey) { params.set("field", result.problem.fieldKey); params.set("reason", result.problem.reason); }
    redirect(`/events/${slug}/status/${token}/edit?${params}`);
  }
  if (result.status === "closed") redirect(`/events/${slug}/status/${token}/edit`);
  revalidatePath(`/events/${slug}/status/${token}`);
  redirect(`/events/${slug}/status/${token}?updated=${result.status === "saved" ? "1" : "0"}`);
}

export async function changeOwnDaysAction(slug: string, token: string, formData: FormData) {
  if (!(await isFeatureEnabled("selfDayChange"))) redirect(`/events/${slug}/status/${token}?error=disabled`);
  const result = await changeOwnDays(slug, token, formData.getAll("dayId"));
  if (result === "not-found") notFound();
  if (result !== "saved" && result !== "unchanged") redirect(`/events/${slug}/status/${token}/days?error=${result}`);
  revalidatePath(`/events/${slug}`);
  revalidatePath(`/events/${slug}/status/${token}`);
  redirect(`/events/${slug}/status/${token}?days=${result === "saved" ? "1" : "0"}`);
}

export async function requestDeletionAction(slug: string, token: string, formData: FormData) {
  if (!(await isFeatureEnabled("dataDeletionRequest"))) redirect(`/events/${slug}/status/${token}?error=disabled`);
  if (formData.get("confirm") !== "on") redirect(`/events/${slug}/status/${token}?error=delete-confirm#delete-request`);
  const result = await requestOwnDeletion(slug, token, formData.get("reason"));
  if (result === "not-found") notFound();
  redirect(`/events/${slug}/status/${token}?deletion=requested#delete-request`);
}
