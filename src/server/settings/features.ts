import type { UserRole } from "@prisma/client";
import { cache } from "react";

import { featureDefinitions, type FeatureDefinition, type FeatureFlags, type FeatureKey } from "@/features/settings/features";
import { db } from "@/server/db";

/** Default before an admin saves a value. The kiosk keeps honouring FEATURE_KIOSK from earlier releases. */
export function featureDefault(feature: FeatureDefinition) {
  if (feature.key === "kiosk") return process.env.FEATURE_KIOSK === "true";
  return feature.defaultEnabled;
}

/**
 * Current switches, read once per request (no cross-request cache, so an admin's change applies on the next page
 * load). Features that are not built yet always read as off.
 */
export const getFeatureFlags = cache(async (): Promise<FeatureFlags> => {
  const rows = await db.systemSetting.findMany({ select: { key: true, enabled: true } });
  const saved = new Map(rows.map((row) => [row.key, row.enabled]));
  return Object.fromEntries((featureDefinitions as readonly FeatureDefinition[]).map((feature) => [
    feature.key,
    feature.availability?.status === "not-built" ? false : saved.get(feature.key) ?? featureDefault(feature),
  ])) as FeatureFlags;
});

export async function isFeatureEnabled(key: FeatureKey) {
  return (await getFeatureFlags())[key];
}

/** Whether every env key a feature needs is set (values are never exposed). */
export function envConfigured(names: readonly string[] = []) {
  return names.every((name) => !!process.env[name]?.trim());
}

/**
 * Publishing on production needs both Turnstile keys, otherwise every public submit would fail the captcha —
 * unless an admin switched Turnstile off.
 */
export async function captchaReadyToPublish() {
  return process.env.NODE_ENV !== "production"
    || !(await isFeatureEnabled("turnstile"))
    || envConfigured(["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
}

/** Admins can always create events; organizers only while the admin switch allows it. */
export async function mayCreateEvents(role: UserRole) {
  if (role === "ADMIN") return true;
  return isFeatureEnabled("organizerCreateEvents");
}
