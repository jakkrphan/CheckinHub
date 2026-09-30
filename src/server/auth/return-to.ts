/** Accepts only same-site staff paths, so a crafted ?next= cannot redirect off-site or into auth endpoints. */
export function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return /^\/(organizer|admin|check-in|account\/password)(\/|\?|$)/.test(value) ? value.slice(0, 500) : null;
}
