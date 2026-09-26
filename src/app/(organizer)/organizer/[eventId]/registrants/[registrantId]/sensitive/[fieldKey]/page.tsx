import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { readFileAnswers, readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

export default async function SensitiveAnswerPage({ params }: PageProps<"/organizer/[eventId]/registrants/[registrantId]/sensitive/[fieldKey]">) {
  const { eventId, registrantId, fieldKey } = await params;
  const { event, user } = await requireEventAccess(eventId, "view");
  const field = readRegistrationFields(event.fields).find((item) => item.key === fieldKey && item.sensitive);
  if (!field) notFound();
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId }, select: { answers: true } });
  if (!person?.answers || typeof person.answers !== "object" || Array.isArray(person.answers)) notFound();
  const answer = (person.answers as Record<string, unknown>)[fieldKey];
  if (answer == null) notFound();
  await db.auditLog.create({ data: { eventId, actorId: user.id, action: "SENSITIVE_ANSWER_VIEWED", target: registrantId, metadata: { fieldKey } } });
  const files = field.type === "file" ? readFileAnswers(answer) : [];
  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-8 lg:px-10">
    <Button asChild variant="outline" className="w-fit"><Link href={`/organizer/${eventId}/registrants`}>กลับไปรายชื่อ</Link></Button>
    <section className="rounded-xl border bg-card p-6"><h1 className="font-heading text-xl font-bold">{field.label}</h1><p className="mt-1 text-sm text-muted-foreground">ข้อมูลอ่อนไหว · มีบันทึกการเปิดดู</p>
      {files.length ? <div className="mt-5 flex flex-wrap gap-2">{files.map((file, index) => <Button key={file.storageKey} asChild variant="outline"><Link href={`/organizer/${eventId}/registrants/${registrantId}/files/${fieldKey}${index ? `?i=${index}` : ""}`}>ดาวน์โหลด {file.originalName}</Link></Button>)}</div>
        : <p className="mt-5 whitespace-pre-wrap break-words text-base">{Array.isArray(answer) ? answer.join(", ") : String(answer)}</p>}
    </section>
  </main>;
}
