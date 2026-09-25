"use client";

import { useOptimistic, useState, useTransition } from "react";
import { GripVerticalIcon } from "lucide-react";

import { moveRegistrationField, moveRegistrationFieldTo, removeRegistrationField, updateRegistrationField } from "@/app/(organizer)/organizer/field-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RegistrationFieldConfig } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";

type FieldBuilderProps = {
  eventId: string;
  fields: RegistrationFieldConfig[];
  editable: boolean;
};

function isValidOrder(fields: RegistrationFieldConfig[]) {
  const indexByKey = new Map(fields.map((field, index) => [field.key, index]));
  return fields.every((field) => !field.conditional || (indexByKey.get(field.conditional.field) ?? Infinity) < (indexByKey.get(field.key) ?? -Infinity));
}

export function FieldBuilder({ eventId, fields: initialFields, editable }: FieldBuilderProps) {
  const [fields, setFields] = useOptimistic(initialFields);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function dropOn(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) {
      setDraggedKey(null);
      setDropKey(null);
      return;
    }

    const targetIndex = fields.findIndex((field) => field.key === targetKey);
    const sourceIndex = fields.findIndex((field) => field.key === draggedKey);
    if (targetIndex < 0 || sourceIndex < 0) return;
    const next = [...fields];
    const [moving] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moving);
    setDraggedKey(null);
    setDropKey(null);

    if (!isValidOrder(next)) {
      setMessage("ฟิลด์แบบมีเงื่อนไขต้องอยู่หลังฟิลด์แม่");
      return;
    }

    setMessage("กำลังบันทึกลำดับฟิลด์");
    startTransition(async () => {
      setFields(next);
      await moveRegistrationFieldTo(eventId, moving.key, targetIndex);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">ลากจุดจับเพื่อเรียงลำดับฟิลด์ หรือใช้ปุ่มขึ้นลงเพื่อเลื่อนทีละตำแหน่ง</p>
      {message && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>}
      <ol aria-label="ลำดับฟิลด์ลงทะเบียน" className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <li
            key={field.key}
            onDragOver={(event) => { if (editable && draggedKey) event.preventDefault(); }}
            onDragEnter={() => { if (editable && draggedKey && draggedKey !== field.key) setDropKey(field.key); }}
            onDrop={(event) => { event.preventDefault(); if (editable) dropOn(field.key); }}
            className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4", dropKey === field.key && "border-primary")}
          >
            <div className="flex min-w-0 items-center gap-3">
              {editable && <Button
                type="button"
                variant="ghost"
                size="icon"
                draggable={!isPending}
                aria-label={`ลากเพื่อย้ายฟิลด์ ${field.label}`}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", field.key); setDraggedKey(field.key); setMessage(""); }}
                onDragEnd={() => { setDraggedKey(null); setDropKey(null); }}
                className="cursor-grab active:cursor-grabbing"
              ><GripVerticalIcon aria-hidden="true" /></Button>}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{field.label}</span>
                <span className="truncate text-xs text-muted-foreground">{field.type}{field.options?.length ? ` · ${field.options.join(", ")}` : ""}</span>
                {field.conditional && <span className="text-xs text-muted-foreground">แสดงเมื่อ {initialFields.find((parent) => parent.key === field.conditional?.field)?.label ?? "ฟิลด์ก่อนหน้า"} ตรงกับ {Array.isArray(field.conditional.value) ? field.conditional.value.join(", ") : field.conditional.value}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {field.required && <Badge variant="outline">บังคับ</Badge>}
              {field.showOnCheckin && <Badge variant="outline">แสดงตอนเช็คชื่อ</Badge>}
              {field.sensitive && <Badge variant="secondary">ข้อมูลอ่อนไหว</Badge>}
              {editable && <>
                <form action={moveRegistrationField.bind(null, eventId, field.key, "up")}><Button type="submit" variant="ghost" size="sm" disabled={index === 0 || isPending} aria-label={`เลื่อน ${field.label} ขึ้น`}>↑</Button></form>
                <form action={moveRegistrationField.bind(null, eventId, field.key, "down")}><Button type="submit" variant="ghost" size="sm" disabled={index === fields.length - 1 || isPending} aria-label={`เลื่อน ${field.label} ลง`}>↓</Button></form>
                <form action={removeRegistrationField.bind(null, eventId, field.key)}><Button type="submit" variant="ghost" size="sm" disabled={isPending}>ลบฟิลด์</Button></form>
              </>}
            </div>
            {editable && <form action={updateRegistrationField.bind(null, eventId, field.key)} className="flex w-full flex-col gap-3 border-t pt-3">
              <FieldGroup className="sm:flex-row">
                <Field><FieldLabel htmlFor={`edit-label-${field.key}`}>แก้ชื่อฟิลด์</FieldLabel><Input id={`edit-label-${field.key}`} name="label" defaultValue={field.label} maxLength={191} required /></Field>
                {(field.type === "select" || field.type === "checkbox") && <Field><FieldLabel htmlFor={`edit-options-${field.key}`}>ตัวเลือก (หนึ่งค่าต่อบรรทัด)</FieldLabel><Textarea id={`edit-options-${field.key}`} name="optionsText" defaultValue={field.options?.join("\n")} rows={2} maxLength={3000} required /></Field>}
              </FieldGroup>
              <Field orientation="horizontal"><input id={`edit-required-${field.key}`} name="required" type="checkbox" defaultChecked={field.required} className="size-4 accent-primary" /><FieldLabel htmlFor={`edit-required-${field.key}`}>บังคับกรอก</FieldLabel></Field>
              <Field orientation="horizontal"><input id={`edit-checkin-${field.key}`} name="showOnCheckin" type="checkbox" defaultChecked={field.showOnCheckin} className="size-4 accent-primary" /><FieldLabel htmlFor={`edit-checkin-${field.key}`}>แสดงตอนเช็คชื่อ</FieldLabel></Field>
              <Field orientation="horizontal"><input id={`edit-sensitive-${field.key}`} name="sensitive" type="checkbox" defaultChecked={field.sensitive} className="size-4 accent-primary" /><FieldLabel htmlFor={`edit-sensitive-${field.key}`}>ข้อมูลอ่อนไหว</FieldLabel></Field>
              <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={isPending}>บันทึกฟิลด์</Button>
            </form>}
          </li>
        ))}
      </ol>
    </div>
  );
}
