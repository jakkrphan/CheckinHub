// Cover image names and URLs (served by /events/[slug]/cover). No server imports — in particular not sharp — so pages,
// the cover route and the retention job can use them without loading the image library.

/**
 * Public URL of a cover. The version (`?v=`) changes with every upload, so a cached copy is never stale content;
 * the route still caches only for a day so a removed cover disappears from browsers and CDNs within a day — do not
 * raise it to a year or add `immutable` (a person may ask to be taken off a picture).
 */
export const coverImageUrl = (slug: string, key: string) => `/events/${slug}/cover?v=${key.slice(0, 8)}`;

/** The 320×180 version for lists; covers without a thumbnail get the full image instead (see the cover route). */
export const coverThumbUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}size=thumb`;

/**
 * Where a cover's small version would be: null for jpg/png covers from before thumbnails. A `.webp` cover uploaded
 * before then has no thumbnail file either; the cover route falls back to the full image when it is missing.
 */
export const coverThumbKey = (key: string) => key.endsWith(".webp") && !key.includes(".thumb.") ? key.replace(/\.webp$/i, ".thumb.webp") : null;
