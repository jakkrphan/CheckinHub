import { readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

function csvCell(value: unknown) {
  const raw = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request, context: RouteContext<"/organizer/[eventId]/registrants/export">) {
  const { eventId } = await context.params;
  const { event, user } = await requireEventAccess(eventId, "view");
  const includeSensitive = new URL(request.url).searchParams.get("includeSensitive") === "on";
  const [registrants, sessions] = await Promise.all([
    db.registrant.findMany({ where: { eventId }, orderBy: { registeredAt: "asc" }, include: { days: { include: { eventDay: true } }, checkIns: { where: { voidedAt: null } } } }),
    db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { label: "asc" }], include: { eventDay: { select: { date: true } } } }),
  ]);
  const fields = readRegistrationFields(event.fields).filter((field) => includeSensitive || !field.sensitive);
  const rows = [["อีเมล", "สถานะ", "วันที่ลงทะเบียน", "วันที่และสถานะ", ...fields.map((field) => field.label), ...sessions.map((session) => `เช็คชื่อ: ${session.label} · ${session.eventDay ? session.eventDay.date.toISOString().slice(0, 10) : "ทุกวัน"}`)],
    ...registrants.map((person) => {
      const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
      return [person.email, person.status, person.registeredAt.toISOString(), person.days.map((day) => `${day.eventDay.date.toISOString().slice(0, 10)}: ${day.status}`).join("; "),
        ...fields.map((field) => {
          const answer = answers[field.key];
          return field.type === "file" && answer && typeof answer === "object" && !Array.isArray(answer)
            ? (answer as { originalName?: unknown }).originalName : answer;
        }), ...sessions.map((session) => person.checkIns.find((checkIn) => checkIn.sessionId === session.id)?.checkedInAt.toISOString() ?? "")];
    })];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  await db.auditLog.create({ data: { eventId, actorId: user.id, action: "EXPORT_CSV", target: eventId, metadata: { rowCount: registrants.length, includeSensitive } } });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="registrants-${eventId}.csv"`, "cache-control": "no-store" } });
}
