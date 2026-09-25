"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminUser } from "@/server/authorization/session";
import { deleteEventPreservingHistory } from "@/server/events/delete-event";

export async function deleteEvent(eventId: string) {
  const admin = await requireAdminUser();
  const parsedId = z.string().cuid().safeParse(eventId);
  if (!parsedId.success) throw new Error("Invalid event id");
  const result = await deleteEventPreservingHistory(parsedId.data, admin.id);
  if (!result) redirect("/admin?view=events&deleted=missing");
  revalidatePath("/admin");
  revalidatePath("/organizer");
  revalidatePath(`/events/${result.slug}`);
  redirect(`/admin?view=events&deleted=${result.retained ? "archived" : "1"}`);
}
