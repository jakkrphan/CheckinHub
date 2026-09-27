import { readFileAnswers, readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { docxContentType, readLocalRegistrationFile } from "@/server/registrations/local-files";

const contentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", docxContentType]);

/**
 * Downloads one attachment; multi-file answers pick the file with `?i=` (0-based, default 0). Files of a field that was
 * later removed from the form stay downloadable until retention deletes them.
 */
export async function GET(request: Request, context: RouteContext<"/organizer/[eventId]/registrants/[registrantId]/files/[fieldKey]">) {
  const { eventId, registrantId, fieldKey } = await context.params;
  const { event, user } = await requireEventAccess(eventId, "view");
  const fields = readRegistrationFields(event.fields);
  const field = fields.find((item) => item.key === fieldKey);
  if (field && field.type !== "file") return new Response("Not found", { status: 404 });

  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId }, select: { answers: true } });
  const answers = person?.answers && typeof person.answers === "object" && !Array.isArray(person.answers)
    ? person.answers as Record<string, unknown> : {};
  const index = Number(new URL(request.url).searchParams.get("i") ?? "0");
  const file = Number.isInteger(index) && index >= 0 ? readFileAnswers(answers[fieldKey])[index] : undefined;
  if (!file || typeof file.originalName !== "string" || typeof file.contentType !== "string" || !contentTypes.has(file.contentType)) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await readLocalRegistrationFile(file.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  await db.auditLog.create({ data: { eventId, actorId: user.id, action: "FILE_DOWNLOADED", target: registrantId, metadata: { fieldKey, index } } });
  const safeName = file.originalName.replace(/[\r\n\0"\\]/g, "_").slice(0, 180) || "attachment";
  return new Response(new Uint8Array(bytes), { headers: {
    "content-type": file.contentType,
    "content-disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  } });
}
