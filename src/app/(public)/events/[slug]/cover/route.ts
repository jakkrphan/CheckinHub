import { coverThumbKey } from "@/features/events/cover-url";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { openStoredFile, statStoredFile } from "@/server/registrations/file-store";

const contentTypeByExtension: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * The event's cover image (`?size=thumb` for lists). A URL carrying the current version (`?v=`, see coverImageUrl)
 * never changes content — a new upload gets a new key and URL — so browsers and any proxy/CDN in front may keep it for
 * a day. Not longer: a removed cover, an event back in draft or a deleted event must stop showing within a day (e.g. a
 * person asked to be taken off the picture). Unversioned URLs (covers saved before versions) get a short cache.
 */
async function cover(request: Request, context: RouteContext<"/events/[slug]/cover">, withBody: boolean) {
  const { slug } = await context.params;
  const event = await db.event.findUnique({ where: { slug, deletedAt: null }, select: { id: true, status: true, coverImageKey: true } });
  if (!event?.coverImageKey) return new Response("Not found", { status: 404 });
  if (event.status === "DRAFT") await requireEventAccess(event.id, "view");

  const search = new URL(request.url).searchParams;
  const thumb = search.get("size") === "thumb" ? coverThumbKey(event.coverImageKey) : null;
  // Checked before anything is opened, so no 404 below leaves a file handle behind.
  const contentType = contentTypeByExtension[event.coverImageKey.split(".").pop()?.toLowerCase() ?? ""];
  if (!contentType) return new Response("Not found", { status: 404 });
  // Covers from before thumbnails (including .webp ones) have no small file: send the full image instead.
  // HEAD only needs the size, so the file is not opened for a body nobody reads.
  const read: (key: string) => Promise<{ body?: ReadableStream<Uint8Array>; size: number } | null> = withBody ? openStoredFile : statStoredFile;
  const file = (thumb ? await read(thumb) : null) ?? await read(event.coverImageKey);
  if (!file) return new Response("Not found", { status: 404 });
  const current = search.get("v") === event.coverImageKey.slice(0, 8);
  return new Response(file.body ?? null, { headers: {
    "content-type": contentType,
    "content-length": String(file.size),
    "cache-control": event.status === "DRAFT" ? "private, no-store" : current ? "public, max-age=86400" : "public, max-age=300, stale-while-revalidate=3600",
    "x-content-type-options": "nosniff",
  } });
}

export const GET = (request: Request, context: RouteContext<"/events/[slug]/cover">) => cover(request, context, true);
export const HEAD = (request: Request, context: RouteContext<"/events/[slug]/cover">) => cover(request, context, false);
