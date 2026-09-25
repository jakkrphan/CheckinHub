"use client";

import { useState } from "react";

import { registerPublicEvent } from "@/app/(public)/events/[slug]/actions";
import { addManualRegistrant } from "@/app/(organizer)/organizer/[eventId]/registrants/new/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { conditionMatches, type RegistrationFieldConfig } from "@/features/events/registration-fields";

type DayOption = { id: string; label: string; remaining: number | null; maxSeats: number | null; isClosed?: boolean };

export function RegistrationForm({ slug, fields, days, captchaSiteKey, organizerEventId, seatMode = "per_day", courseRemaining = null }: {
  slug: string;
  fields: RegistrationFieldConfig[];
  days: DayOption[];
  captchaSiteKey: string;
  organizerEventId?: string;
  seatMode?: string;
  courseRemaining?: number | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const submit = organizerEventId ? addManualRegistrant.bind(null, organizerEventId) : registerPublicEvent.bind(null, slug);

  return (
    <form action={submit} className="flex flex-col gap-8 rounded-xl border bg-card p-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="registration-email">อีเมลสำหรับติดต่อและรับผล</FieldLabel>
          <Input id="registration-email" name="email" type="email" autoComplete="email" maxLength={191} required />
        </Field>
        {seatMode === "whole_course" ? <div className="rounded-lg border bg-accent p-4 text-sm"><strong>หลักสูตรต่อเนื่อง · สมัครครบทุกวัน</strong><p>ที่นั่งคงเหลือทั้งหลักสูตร: {courseRemaining === null ? "ไม่จำกัด" : courseRemaining === 0 ? "เต็ม · เข้าคิวสำรองได้" : courseRemaining}</p><ul className="mt-2 list-inside list-disc">{days.map((day) => <li key={day.id}>{day.label}</li>)}</ul></div> : <FieldSet>
          <FieldLegend variant="label">เลือกวันที่เข้าร่วม (เลือกได้หลายวัน)</FieldLegend>
          {days.map((day) => (
            <label key={day.id} className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
              <input type="checkbox" name="dayId" value={day.id} disabled={day.isClosed} className="size-4 accent-primary" />
              <span>{day.label} · {day.isClosed ? "ปิดรับวันนี้" : day.remaining === null ? "ไม่จำกัดที่นั่ง" : day.remaining === 0 ? "เต็มแล้ว (ลงคิวสำรองได้)" : `เหลือ ${day.remaining}/${day.maxSeats} ที่นั่ง`}</span>
            </label>
          ))}
        </FieldSet>}
        {fields.map((field) => {
          if (!conditionMatches(field, answers)) return null;
          const name = `answer:${field.key}`;
          return (
            <Field key={field.key}>
              <FieldLabel htmlFor={`answer-${field.key}`}>{field.label}{field.required ? " *" : ""}</FieldLabel>
              {field.type === "textarea" ? (
                <Textarea id={`answer-${field.key}`} name={name} required={field.required} maxLength={3000} rows={4} onChange={(event) => setAnswers((previous) => ({ ...previous, [field.key]: event.target.value }))} />
              ) : field.type === "select" ? (
                <NativeSelect id={`answer-${field.key}`} name={name} required={field.required} defaultValue="" onChange={(event) => setAnswers((previous) => ({ ...previous, [field.key]: event.target.value }))}>
                  <option value="">เลือกคำตอบ</option>
                  {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                </NativeSelect>
              ) : field.type === "checkbox" ? (
                <div className="flex flex-col gap-2">
                  {field.options?.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={name} value={option} className="size-4 accent-primary" onChange={(event) => setAnswers((previous) => {
                        const selected = Array.isArray(previous[field.key]) ? previous[field.key] as string[] : [];
                        return { ...previous, [field.key]: event.target.checked ? [...selected, option] : selected.filter((item) => item !== option) };
                      })} />
                      {option}
                    </label>
                  ))}
                  {field.required && <FieldDescription>เลือกอย่างน้อยหนึ่งข้อ</FieldDescription>}
                </div>
              ) : field.type === "file" ? (
                <>
                  <Input id={`answer-${field.key}`} name={name} type="file" required={field.required} accept={field.acceptedFileTypes?.map((type) => `.${type.replace(/^\./, "")}`).join(",")} />
                  <FieldDescription>ไฟล์ {field.acceptedFileTypes?.join(", ")}; ไม่เกิน {field.maxFileSizeMb} MB (เก็บในเครื่องเซิร์ฟเวอร์สำหรับ local testing)</FieldDescription>
                </>
              ) : (
                <Input id={`answer-${field.key}`} name={name} type={field.type} required={field.required} maxLength={field.type === "tel" ? 30 : 3000} onChange={(event) => setAnswers((previous) => ({ ...previous, [field.key]: event.target.value }))} />
              )}
            </Field>
          );
        })}
        <Field orientation="horizontal">
          <input id="consent" name="consent" type="checkbox" className="size-4 accent-primary" required />
          <FieldLabel htmlFor="consent">{organizerEventId ? "ยืนยันว่าได้รับความยินยอมจากผู้เข้าร่วมให้บันทึกข้อมูลเพื่อการลงทะเบียนและเช็คชื่อแล้ว" : "ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลเพื่อจัดการลงทะเบียนและเช็คชื่อกิจกรรมนี้"}</FieldLabel>
        </Field>
        {organizerEventId && <Field orientation="horizontal"><input id="approveNow" name="approveNow" type="checkbox" className="size-4 accent-primary" /><FieldLabel htmlFor="approveNow">อนุมัติทันทีหากยังมีที่นั่ง</FieldLabel></Field>}
        {organizerEventId && <Field orientation="horizontal"><input id="overrideCapacity" name="overrideCapacity" type="checkbox" className="size-4 accent-primary" /><div className="flex flex-col gap-1"><FieldLabel htmlFor="overrideCapacity">อนุมัติเกินที่นั่ง (กรณีจำเป็น)</FieldLabel><FieldDescription>ใช้คู่กับ “อนุมัติทันที” เมื่อที่นั่งเต็ม ระบบจะอนุมัติเกินจำนวนและบันทึกไว้ใน audit log</FieldDescription></div></Field>}
      </FieldGroup>
      {!organizerEventId && captchaSiteKey && <div className="cf-turnstile" data-sitekey={captchaSiteKey} />}
      <Button type="submit" size="lg">{organizerEventId ? "เพิ่มผู้สมัครและเปิดลิงก์สถานะ" : "ส่งใบสมัคร"}</Button>
    </form>
  );
}
