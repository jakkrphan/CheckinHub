import { FieldBuilder } from "@/app/(organizer)/organizer/[eventId]/field-builder";
import { fieldsOf, type RegistrationFormItem } from "@/features/events/registration-fields";
import { countAnswersByField } from "@/server/events/field-answers";

/** Settings step 3: form header with the form version, plus the builder with per-field answer counts. */
export async function FieldBuilderStep({ eventId, items, fieldsVersion, editable, selectedField, errorCode, error }: {
  eventId: string;
  /** The stored form in order: fields and page breaks. */
  items: RegistrationFormItem[];
  fieldsVersion: number;
  editable: boolean;
  selectedField?: string;
  errorCode?: string;
  error?: string;
}) {
  const counts = await countAnswersByField(eventId, fieldsOf(items).map((field) => field.key));
  return <section className="flex flex-col gap-7">
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">ลากเรียงลำดับได้ · ฟิลด์ลูกจะโผล่เฉพาะเมื่อฟิลด์แม่ถูกเลือกตามเงื่อนไข · ใช้ตัวแบ่งหน้าเพื่อแบ่งฟอร์มสมัครเป็นหลายหน้า</p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="font-heading text-[22px] font-bold">ฟอร์มลงทะเบียน</h2>
        <span className="inline-flex items-center rounded-md bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{`เวอร์ชันฟอร์ม v${fieldsVersion}`}</span>
        <span className="text-xs text-muted-foreground">บันทึกไว้กับผู้ลงทะเบียนแต่ละคนว่ากรอกตามฟอร์มเวอร์ชันไหน</span>
      </div>
    </div>
    <FieldBuilder key={items.map((item) => item.key).join(",")} eventId={eventId} items={items} editable={editable} answerCounts={Object.fromEntries(counts)} initialSelected={selectedField} error={error} errorCode={errorCode} />
  </section>;
}
