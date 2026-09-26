// Features that exist in code but are switched off for this release. Server-side only.

/**
 * Self check-in kiosk with a staff PIN (spec §3, optional). Off for now: the PIN only lives in the browser tab,
 * so it needs a proper "forgot PIN" flow before release. Set FEATURE_KIOSK=true to turn it back on.
 */
export const kioskEnabled = process.env.FEATURE_KIOSK === "true";
