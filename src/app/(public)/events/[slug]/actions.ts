"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { registerForEvent } from "@/server/registrations/registration";

export async function registerPublicEvent(slug: string, formData: FormData) {
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const result = await registerForEvent(slug, formData, ip);
  if (!result.ok) {
    const params = new URLSearchParams({ error: result.reason });
    if (result.problem?.fieldKey) { params.set("field", result.problem.fieldKey); params.set("problem", result.problem.reason); }
    redirect(`/events/${slug}?${params}`);
  }
  const statusPath = `/events/${slug}/status/${result.token}`;
  // Chose LINE: to the status page first, where one tap starts LINE Login. Going straight to LINE would leave someone with
  // no email holding no way back if LINE then fails or is cancelled in its in-app browser (the callback cannot hand out
  // the status link there); with the status page in this browser's history, they can always return to it.
  if (result.notifyVia === "LINE") redirect(`${statusPath}?line=start#line`);
  redirect(statusPath);
}
