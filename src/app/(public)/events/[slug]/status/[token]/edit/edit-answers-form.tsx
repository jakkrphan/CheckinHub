"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { conditionMatches, type RegistrationFieldConfig } from "@/features/events/registration-fields";

type AnswerValue = string | string[];

export function EditAnswersForm({ action, fields, initial, files, fieldsVersion, newFields = [], problem }: {
  action: (formData: FormData) => Promise<void>;
  fields: RegistrationFieldConfig[];
  initial: Record<string, AnswerValue>;
  files: Record<string, string>;
  /** Sent back so the server can tell a stale page (form changed meanwhile) from a real mistake. */
  fieldsVersion: number;
  /** Required questions added after this person registered. */
  newFields?: string[];
  /** The field the last save failed on. */
  problem?: { key: string; message: string };
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(initial);
  const set = (key: string, value: AnswerValue) => setAnswers((current) => ({ ...current, [key]: value }));

  return <form action={action} className="flex flex-col gap-5 rounded-xl border bg-card p-5">
    <input type="hidden" name="fieldsVersion" value={fieldsVersion} />
    <FieldGroup>
      {fields.map((field) => {
        if (!conditionMatches(field, answers)) return null;
        const id = `edit-${field.key}`;
        const name = `answer:${field.key}`;
        const value = answers[field.key];
        const invalid = problem?.key === field.key;
        return <Field key={field.key} data-invalid={invalid || undefined}>
          <FieldLabel htmlFor={id}>{field.label}{field.required ? " *" : ""}{newFields.includes(field.key) && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">ใหม่</span>}</FieldLabel>
          {field.type === "textarea" ? <Textarea id={id} name={name} required={field.required} maxLength={3000} rows={4} value={typeof value === "string" ? value : ""} onChange={(event) => set(field.key, event.target.value)} />
            : field.type === "select" ? <NativeSelect id={id} name={name} required={field.required} value={typeof value === "string" ? value : ""} onChange={(event) => set(field.key, event.target.value)}><option value="">เลือกคำตอบ</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
            : field.type === "checkbox" ? <div className="flex flex-col gap-2">{field.options?.map((option) => {
              const selected = Array.isArray(value) ? value : [];
              return <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value={option} checked={selected.includes(option)} onChange={(event) => set(field.key, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} className="size-4 accent-primary" />{option}</label>;
            })}{field.required && <FieldDescription>เลือกอย่างน้อยหนึ่งข้อ</FieldDescription>}</div>
            : field.type === "file" ? <p id={id} className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">{files[field.key] ? `ไฟล์เดิม: ${files[field.key]}` : "ยังไม่มีไฟล์"} · เปลี่ยนไฟล์ได้โดยติดต่อผู้จัด</p>
            : <Input id={id} name={name} type={field.type} required={field.required} maxLength={field.type === "tel" ? 30 : 3000} value={typeof value === "string" ? value : ""} onChange={(event) => set(field.key, event.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-problem` : undefined} />}
          {invalid && <p id={`${id}-problem`} className="text-sm text-destructive">{problem.message}</p>}
        </Field>;
      })}
    </FieldGroup>
    <p className="text-xs text-muted-foreground">อีเมลและวันที่เลือกแก้ในหน้านี้ไม่ได้ ทุกการแก้ไขถูกบันทึกไว้ให้ผู้จัดตรวจสอบย้อนหลังได้</p>
    <Button type="submit">บันทึกการแก้ไข</Button>
  </form>;
}
