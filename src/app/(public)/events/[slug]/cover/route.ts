import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { readLocalRegistrationFile } from "@/server/registrations/local-files";

const contentTypeByExtension: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_request: Request, context: RouteContext<"/events/[slug]/cover">) {
  const { slug } = await context.params;
  const event = await db.event.findUnique({ where: { slug, deletedAt: null }, select: { id: true, status: true, coverImageKey: true } });
  if (!event?.coverImageKey) return new Response("Not found", { status: 404 });
  if (event.status === "DRAFT") await requireEventAccess(event.id, "view");

  const extension = event.coverImageKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType = contentTypeByExtension[extension];
  if (!contentType) return new Response("Not found", { status: 404 });
  const bytes = await readLocalRegistrationFile(event.coverImageKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: {
    "content-type": contentType,
    "cache-control": event.status === "DRAFT" ? "private, no-store" : "public, max-age=300, stale-while-revalidate=3600",
    "x-content-type-options": "nosniff",
  } });
}
