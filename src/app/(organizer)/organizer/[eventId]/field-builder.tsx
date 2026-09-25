"use client";

import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, FileIcon, GripVerticalIcon, PlusIcon, ShieldIcon, Trash2Icon, XIcon } from "lucide-react";

import { addRegistrationField, moveRegistrationField, moveRegistrationFieldTo, removeRegistrationField, updateRegistrationField } from "@/app/(organizer)/organizer/field-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { RegistrationFieldConfig } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";

type FieldType = RegistrationFieldConfig["type"];

type FieldBuilderProps = {
  eventId: string;
  fields: RegistrationFieldConfig[];
  editable: boolean;
  initialSelected?: string;
  error?: string;
};

const typeLabels: Record<FieldType, string> = {
  text: "ข้อความสั้น", textarea: "ข้อความยาว", email: "อีเมล", tel: "เบอร์โทรศัพท์", date: "วันที่", select: "ตัวเลือก", checkbox: "เลือกได้หลายข้อ", file: "ไฟล์แนบ",
};
const fileTypes = ["pdf", "jpg", "png", "webp"];
const NEW = "__new__";

function isValidOrder(fields: RegistrationFieldConfig[]) {
  const indexByKey = new Map(fields.map((field, index) => [field.key, index]));
  return fields.every((field) => !field.conditional || (indexByKey.get(field.conditional.field) ?? Infinity) < (indexByKey.get(field.key) ?? -Infinity));
}

const conditionValues = (field: RegistrationFieldConfig) => field.conditional ? (Array.isArray(field.conditional.value) ? field.conditional.value : [field.conditional.value]) : [];

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "muted" | "danger"; children: ReactNode }) {
  return <span className={cn(
    "inline-flex items-center whitespace-nowrap rounded-md px-2.5 py-0.5 text-xs font-semibold",
    tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-muted text-foreground",
  )}>{children}</span>;
}

/** Visual switch backed by a real checkbox so it submits with the form and stays keyboard accessible. */
function Switch({ id, name, label, description, defaultChecked, checked, onChange, disabled, tone = "plain" }: {
  id: string; name?: string; label: string; description?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; tone?: "plain" | "accent";
}) {
  return <label htmlFor={id} className={cn("flex items-center justify-between gap-4", tone === "plain" && "rounded-lg border px-3.5 py-3", disabled && "opacity-60")}>
    <span className="flex flex-col gap-0.5">
      <span className={cn("text-sm font-semibold", tone === "accent" && "font-bold text-accent-foreground")}>{label}</span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
    </span>
    <input id={id} name={name} type="checkbox" className="peer sr-only" defaultChecked={defaultChecked} checked={checked} onChange={onChange ? (event) => onChange(event.target.checked) : undefined} disabled={disabled} />
    <span aria-hidden="true" className="relative h-[26px] w-[46px] shrink-0 rounded-full bg-[#cfc9bc] transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-card after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
  </label>;
}

function OptionsEditor({ initial }: { initial: string[] }) {
  const [options, setOptions] = useState(initial.length ? initial : ["", ""]);
  return <div className="flex flex-col gap-2">
    <span className="text-sm font-semibold">ตัวเลือก</span>
    <input type="hidden" name="optionsText" value={options.map((option) => option.trim()).filter(Boolean).join("\n")} />
    {options.map((option, index) => <div key={index} className="flex gap-2">
      <Input aria-label={`ตัวเลือก ${index + 1}`} value={option} maxLength={191} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value.replaceAll(",", " ") : item))} />
      <Button type="button" variant="outline" size="icon" aria-label={`ลบตัวเลือก ${index + 1}`} disabled={options.length <= 2} onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><XIcon aria-hidden="true" /></Button>
    </div>)}
    <button type="button" className="self-start py-1 text-sm font-bold text-primary disabled:opacity-50" disabled={options.length >= 30} onClick={() => setOptions((current) => [...current, ""])}>+ เพิ่มตัวเลือก</button>
    <p className="text-xs text-muted-foreground">อย่างน้อย 2 ตัวเลือก ไม่ซ้ำกัน</p>
  </div>;
}

function ConditionEditor({ field, fields, childFields }: { field: RegistrationFieldConfig | null; fields: RegistrationFieldConfig[]; childFields: RegistrationFieldConfig[] }) {
  const position = field ? fields.findIndex((item) => item.key === field.key) : fields.length;
  // One level deep: only earlier select/checkbox fields that are not conditional themselves can be parents.
  const parents = fields.slice(0, position).filter((item) => (item.type === "select" || item.type === "checkbox") && !item.conditional);
  const [enabled, setEnabled] = useState(!!field?.conditional);
  const [parentKey, setParentKey] = useState(field?.conditional?.field ?? parents[0]?.key ?? "");
  const [values, setValues] = useState<string[]>(field ? conditionValues(field) : []);
  const parent = parents.find((item) => item.key === parentKey);
  const isParent = childFields.length > 0;
  const id = field?.key ?? NEW;

  return <div className="flex flex-col gap-3 rounded-lg bg-accent p-3.5">
    <Switch id={`condition-${id}`} label="แสดงแบบมีเงื่อนไข" tone="accent" checked={enabled} onChange={setEnabled} disabled={isParent || parents.length === 0} />
    {isParent && <p className="text-xs leading-relaxed text-accent-foreground">ฟิลด์นี้เป็นฟิลด์แม่ของ {childFields.length} ฟิลด์ ({childFields.map((child) => child.label).join(", ")}) — แก้ตัวเลือกหรือลบฟิลด์นี้จะกระทบฟิลด์ลูก</p>}
    {!isParent && parents.length === 0 && <p className="text-xs leading-relaxed text-accent-foreground">ต้องมีฟิลด์ชนิดตัวเลือกอยู่ก่อนหน้าฟิลด์นี้ จึงจะตั้งเงื่อนไขได้</p>}
    {enabled && !isParent && parent && <>
      <Field>
        <FieldLabel htmlFor={`condition-parent-${id}`}>แสดงเมื่อฟิลด์</FieldLabel>
        <NativeSelect id={`condition-parent-${id}`} name="conditionField" value={parentKey} onChange={(event) => { setParentKey(event.target.value); setValues([]); }}>
          {parents.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </NativeSelect>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">มีค่าเป็น (เลือกได้หลายค่า)</legend>
        <div className="flex flex-wrap gap-2">{parent.options?.map((option) => {
          const checked = values.includes(option);
          return <label key={option} className={cn("inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", checked ? "border-2 border-primary bg-card font-bold text-accent-foreground" : "bg-card")}>
            <input type="checkbox" name="conditionValues" value={option} checked={checked} required={values.length === 0 && option === parent.options?.[0]} onChange={(event) => setValues((current) => event.target.checked ? [...current, option] : current.filter((item) => item !== option))} className="sr-only" />{option}
          </label>;
        })}</div>
        {values.length === 0 && <p className="text-xs text-accent-foreground">เลือกอย่างน้อย 1 ค่า หรือปิดสวิตช์ถ้าไม่ต้องการเงื่อนไข</p>}
      </fieldset>
    </>}
  </div>;
}

function FileSettings({ field }: { field: RegistrationFieldConfig | null }) {
  const selected = (field?.acceptedFileTypes ?? ["pdf", "jpg", "png"]).map((type) => type === "jpeg" ? "jpg" : type);
  return <section className="flex flex-col gap-3.5 rounded-xl border bg-card p-4.5">
    <div className="flex items-center gap-2.5">
      <span className="flex size-8.5 items-center justify-center rounded-lg bg-muted"><FileIcon className="size-4" aria-hidden="true" /></span>
      <div className="flex flex-col"><span className="font-heading text-base font-bold">ตั้งค่าฟิลด์ไฟล์</span><span className="text-xs text-muted-foreground">{field?.label ?? "ฟิลด์ใหม่"}</span></div>
    </div>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">ชนิดไฟล์ที่รับ</legend>
      <div className="flex flex-wrap gap-2">{fileTypes.map((type) => <label key={type} className="inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-bold has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <input type="checkbox" name="acceptedFileTypes" value={type} defaultChecked={selected.includes(type)} className="sr-only" />{type}
      </label>)}</div>
    </fieldset>
    <Field className="max-w-48">
      <FieldLabel htmlFor={`file-size-${field?.key ?? NEW}`}>ขนาดสูงสุด (MB)</FieldLabel>
      <Input id={`file-size-${field?.key ?? NEW}`} name="maxFileSizeMb" type="number" min={1} max={5} defaultValue={field?.maxFileSizeMb ?? 5} />
    </Field>
    <div className="flex gap-2.5 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground"><ShieldIcon className="size-4 shrink-0" aria-hidden="true" /><span>ไฟล์แนบเป็นข้อมูลส่วนตัว เก็บแบบ private และตรวจชนิด/ขนาดจากเนื้อไฟล์จริงที่ backend ทุกครั้ง · ใน development เก็บในเครื่อง</span></div>
  </section>;
}

export function FieldBuilder({ eventId, fields: initialFields, editable, initialSelected, error }: FieldBuilderProps) {
  const [fields, setFields] = useOptimistic(initialFields);
  const [selected, setSelected] = useState(() => initialSelected === NEW || initialFields.some((field) => field.key === initialSelected) ? initialSelected! : initialFields[0]?.key ?? NEW);
  const [newType, setNewType] = useState<FieldType>("text");
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLFormElement>(null);

  // Below the two-column breakpoint the panel sits under the list, so bring it into view.
  function select(key: string) {
    setSelected(key);
    if (!window.matchMedia("(min-width: 1280px)").matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const current = selected === NEW ? null : fields.find((field) => field.key === selected) ?? null;
  const creating = editable && (selected === NEW || !current);
  const type = current?.type ?? newType;
  const index = current ? fields.findIndex((field) => field.key === current.key) : -1;
  const children = current ? fields.filter((field) => field.conditional?.field === current.key) : [];
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? "ฟิลด์ก่อนหน้า";

  function dropOn(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) { setDraggedKey(null); setDropKey(null); return; }
    const targetIndex = fields.findIndex((field) => field.key === targetKey);
    const sourceIndex = fields.findIndex((field) => field.key === draggedKey);
    if (targetIndex < 0 || sourceIndex < 0) return;
    const next = [...fields];
    const [moving] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moving);
    setDraggedKey(null);
    setDropKey(null);
    if (!isValidOrder(next)) { setMessage("ฟิลด์แบบมีเงื่อนไขต้องอยู่หลังฟิลด์แม่"); return; }
    setMessage("กำลังบันทึกลำดับฟิลด์");
    startTransition(async () => {
      setFields(next);
      await moveRegistrationFieldTo(eventId, moving.key, targetIndex);
    });
  }

  const action = creating ? addRegistrationField.bind(null, eventId) : current ? updateRegistrationField.bind(null, eventId, current.key) : undefined;

  return (
    <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.25fr)_420px]">
      <section className="flex flex-col gap-2.5" aria-label="ฟิลด์ลงทะเบียน">
        {message && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>}
        {fields.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่มีฟิลด์ลงทะเบียน เริ่มจากปุ่ม “เพิ่มฟิลด์”</p>}
        <ol aria-label="ลำดับฟิลด์ลงทะเบียน" className="flex flex-col gap-2.5">
          {fields.map((field) => {
            const active = field.key === selected;
            return <li
              key={field.key}
              onDragOver={(event) => { if (editable && draggedKey) event.preventDefault(); }}
              onDragEnter={() => { if (editable && draggedKey && draggedKey !== field.key) setDropKey(field.key); }}
              onDrop={(event) => { event.preventDefault(); if (editable) dropOn(field.key); }}
              className={cn(
                "flex items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3 transition-colors",
                field.conditional && "ml-7",
                active ? "border-2 border-primary px-[13px] py-[11px]" : "hover:border-input",
                dropKey === field.key && "border-dashed border-primary",
              )}
            >
              {editable ? <span
                draggable={!isPending}
                aria-hidden="true"
                title="ลากเพื่อเรียงลำดับ"
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", field.key); setDraggedKey(field.key); setMessage(""); }}
                onDragEnd={() => { setDraggedKey(null); setDropKey(null); }}
                className="flex cursor-grab text-[#b9b3a6] active:cursor-grabbing"
              ><GripVerticalIcon className="size-4" /></span> : <span className="w-4" aria-hidden="true" />}
              <button type="button" onClick={() => select(field.key)} aria-pressed={active} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none focus-visible:underline">
                <span className="text-sm font-semibold">{field.label}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{field.key}</span>
                {field.conditional && <span className="flex items-center gap-1.5 text-xs text-accent-foreground"><ChevronRightIcon className="size-3.5" aria-hidden="true" />แสดงเมื่อ {labelOf(field.conditional.field)} = {conditionValues(field).join(", ")}</span>}
              </button>
              <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                {field.sensitive && <Chip tone="muted">อ่อนไหว</Chip>}
                {field.showOnCheckin && <Chip tone="muted">หน้าเช็คชื่อ</Chip>}
                <Chip>{field.type}</Chip>
                {field.required ? <Chip tone="danger">บังคับ</Chip> : <Chip tone="muted">ไม่บังคับ</Chip>}
              </span>
            </li>;
          })}
        </ol>
        {editable && <button type="button" onClick={() => select(NEW)} aria-pressed={creating} className={cn("flex h-[46px] items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#c9c3b6] text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary", creating && "border-primary bg-card text-primary")}><PlusIcon className="size-4" aria-hidden="true" />เพิ่มฟิลด์</button>}
        <p className="text-xs leading-relaxed text-muted-foreground">อีเมลและคำยินยอม PDPA เป็นส่วนมาตรฐานท้ายฟอร์ม ไม่ต้องเพิ่มเอง{!editable && " · โครงการที่เผยแพร่แล้วหรือมีผู้ลงทะเบียนแล้วจะล็อกการแก้ฟอร์ม"}</p>
      </section>

      {(current || creating) && <form ref={panel} key={`${selected}:${type}`} action={action} className="flex scroll-mt-4 flex-col gap-4">
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-[17px] font-bold">{creating ? "เพิ่มฟิลด์ใหม่" : editable ? "แก้ไขฟิลด์" : "รายละเอียดฟิลด์"}</h3>
            {editable && current && <div className="flex items-center gap-1.5">
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, current.key, "up")} variant="outline" size="icon" disabled={index <= 0 || isPending} aria-label={`เลื่อน ${current.label} ขึ้น`}><ArrowUpIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, current.key, "down")} variant="outline" size="icon" disabled={index >= fields.length - 1 || isPending} aria-label={`เลื่อน ${current.label} ลง`}><ArrowDownIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={removeRegistrationField.bind(null, eventId, current.key)} formNoValidate variant="outline" size="icon" disabled={isPending || children.length > 0} title={children.length ? "ลบฟิลด์ลูกก่อน" : undefined} aria-label={`ลบฟิลด์ ${current.label}`} className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2Icon aria-hidden="true" /></Button>
            </div>}
          </div>
          {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <fieldset disabled={!editable} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`field-label-${selected}`}>ชื่อฟิลด์ (label)</FieldLabel>
              <Input id={`field-label-${selected}`} name="label" defaultValue={current?.label ?? ""} maxLength={191} placeholder="เช่น ชื่อ-นามสกุล" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`field-type-${selected}`}>ชนิดฟิลด์</FieldLabel>
                {creating
                  ? <NativeSelect id={`field-type-${selected}`} name="type" value={newType} onChange={(event) => setNewType(event.target.value as FieldType)}>{(Object.keys(typeLabels) as FieldType[]).map((value) => <option key={value} value={value}>{value} · {typeLabels[value]}</option>)}</NativeSelect>
                  : <Input id={`field-type-${selected}`} value={`${type} · ${typeLabels[type]}`} readOnly disabled />}
              </Field>
              <Field>
                <FieldLabel htmlFor={`field-key-${selected}`}>key</FieldLabel>
                <Input id={`field-key-${selected}`} value={current?.key ?? "สร้างอัตโนมัติ"} readOnly disabled className="font-mono text-xs" />
              </Field>
            </div>
            {!creating && <FieldDescription className="-mt-2">ชนิดและ key ไม่เปลี่ยนตลอดอายุฟิลด์ เพื่อให้คำตอบเดิมยังอ่านได้</FieldDescription>}
            <Switch id={`field-required-${selected}`} name="required" label="บังคับกรอก" defaultChecked={current?.required ?? false} />
            {(type === "select" || type === "checkbox") && <OptionsEditor initial={current?.options ?? []} />}
            <ConditionEditor field={current} fields={fields} childFields={children} />
            <Switch id={`field-checkin-${selected}`} name="showOnCheckin" label="แสดงบนหน้าจอเช็คชื่อ" description="เจ้าหน้าที่หน้างานเห็นคำตอบนี้ (ใช้กับไฟล์หรือข้อมูลอ่อนไหวไม่ได้)" defaultChecked={current?.showOnCheckin ?? false} disabled={type === "file"} />
            <Switch id={`field-sensitive-${selected}`} name="sensitive" label="ข้อมูลอ่อนไหว" description="ปิดบังในตาราง ต้องยืนยันก่อนเปิดดูหรือส่งออก และบันทึก audit" defaultChecked={current?.sensitive ?? false} />
          </fieldset>
          {editable && <div className="flex justify-end gap-2">
            {creating && fields.length > 0 && <Button type="button" variant="ghost" onClick={() => setSelected(fields[0].key)}>ยกเลิก</Button>}
            <Button type="submit" disabled={isPending}>{creating ? "เพิ่มฟิลด์" : "บันทึกฟิลด์"}</Button>
          </div>}
        </section>
        {type === "file" && <fieldset disabled={!editable} className="contents"><FileSettings field={current} /></fieldset>}
      </form>}
    </div>
  );
}
