"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEventAccess } from "@/server/authorization/event";
import { deleteEventPreservingHistory } from "@/server/events/delete-event";

export async function deleteOwnedEvent(eventId: string, formData: FormData) {
  const { event, user } = await requireEventAccess(eventId, "administer");
  if (formData.get("confirm") !== "on") redirect(`/organizer/${eventId}?step=5&error=confirm-delete`);
  const result = await deleteEventPreservingHistory(event.id, user.id);
  if (!result) redirect("/organizer");
  revalidatePath("/organizer");
  revalidatePath("/admin");
  revalidatePath(`/events/${result.slug}`);
  redirect("/organizer?deleted=1");
}
