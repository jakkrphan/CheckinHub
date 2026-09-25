"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { registerForEvent } from "@/server/registrations/registration";

export async function registerPublicEvent(slug: string, formData: FormData) {
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const result = await registerForEvent(slug, formData, ip);
  if (!result.ok) redirect(`/events/${slug}?error=${result.reason}`);
  redirect(`/events/${slug}/status/${result.token}`);
}
