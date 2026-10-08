// URLs of an event's cover image (served by /events/[slug]/cover). No server imports, so pages can use them freely.

/** Public URL of a cover; the version makes it safe to cache for a year (a new upload gets a new key, so a new URL). */
export const coverImageUrl = (slug: string, key: string) => `/events/${slug}/cover?v=${key.slice(0, 8)}`;

/** The 320×180 version for lists; covers saved before thumbnails existed get the full image instead. */
export const coverThumbUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}size=thumb`;
