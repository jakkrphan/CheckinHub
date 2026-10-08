import { z } from "zod";

import { answerMaxLength, type RegistrationFieldConfig } from "@/features/events/registration-fields";

// Importing registrants from a CSV (e.g. a Google Sheet downloaded as CSV) of people who registered elsewhere and
// already hold a QR with their ticket ID. The browser uses this for the column mapping and preview; the server runs
// the same code again on the same text before anything is stored. No Next.js/database imports, so it is unit-tested.

export const IMPORT_MAX_BYTES = 2_000_000;
export const IMPORT_MAX_ROWS = 3000;
/** Marks imported people in Registrant.consentVersion: they consented in the other system, not through this one. */
export const IMPORTED_CONSENT_VERSION = "imported";

/** RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF, an optional UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === "") quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  // Sheets pads trailing empty rows with commas only.
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

/** Where a CSV column goes: the ticket ID (the QR code), the email, the attended dates, a form field, or nowhere. */
export type ImportTarget = "ignore" | "ticket" | "email" | "dates" | `field:${string}`;

const normalize = (value: string) => value.toLowerCase().replace(/[\s_\-.:()]/g, "");

/** Importable form fields: everything but file uploads (there is no file to import). */
export const importableFields = (fields: RegistrationFieldConfig[]) => fields.filter((field) => field.type !== "file");

/** A first guess for each column from its header; the organizer can change every one. */
export function guessTargets(headers: string[], fields: RegistrationFieldConfig[]): ImportTarget[] {
  const candidates = importableFields(fields);
  const used = new Set<ImportTarget>();
  const phoneField = candidates.find((field) => field.type === "tel");
  const nameField = candidates.find((field) => field.type === "text" && (/ชื่อ|name/i.test(field.label) || /name/i.test(field.key)));
  return headers.map((header) => {
    const text = normalize(header);
    const byLabel = candidates.find((field) => normalize(field.label) === text || normalize(field.key) === text);
    const guess: ImportTarget = /ticket|qr|รหัส/.test(text) ? "ticket"
      : /^e?mail|อีเมล/.test(text) ? "email"
      : /date|วันที่เข้า|วันอบรม|attending/.test(text) ? "dates"
      : byLabel ? `field:${byLabel.key}`
      : /phone|tel|โทร|mobile/.test(text) && phoneField ? `field:${phoneField.key}`
      : /name|ชื่อ/.test(text) && nameField ? `field:${nameField.key}`
      : "ignore";
    if (guess !== "ignore" && used.has(guess)) return "ignore";
    used.add(guess);
    return guess;
  });
}

/** Ticket IDs as printed in the QR (e.g. REG-43DBA34C): letters, digits, - and _ only. Stored upper-case. */
const TICKET = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

/**
 * Phone numbers: digits only, and a Thai number whose leading 0 a spreadsheet dropped (838622235) gets it back.
 * Anything that is not 9–10 digits is kept as written for the organizer to fix later.
 */
export function normalizePhone(value: string) {
  const digits = value.replace(/[\s\-().]/g, "");
  if (/^[689][0-9]{8}$/.test(digits)) return `0${digits}`;
  if (/^0[0-9]{9}$/.test(digits)) return digits;
  return value.trim();
}

const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thaiMonthsLong = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** A year as written: 2-digit or 4-digit, Buddhist (พ.ศ., > 2400) or Christian. */
function fullYear(text: string) {
  const year = Number(text);
  if (text.length <= 2) return 2500 + year - 543;
  return year > 2400 ? year - 543 : year;
}

/** One date as Y-M-D: "17 พ.ย. 69", "17 พฤศจิกายน 2569", "17/11/2569", "17/11/2026" or "2026-11-17". */
export function parseImportDate(text: string): string | null {
  const value = text.trim().replace(/\s+/g, " ");
  const pad = (number: number) => String(number).padStart(2, "0");
  const ymd = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : null;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return ymd(fullYear(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) return ymd(fullYear(match[3]), Number(match[2]), Number(match[1]));
  match = value.match(/^(\d{1,2}) (\S+) (\d{2}|\d{4})$/);
  if (match) {
    const month = thaiMonths.indexOf(match[2]) + 1 || thaiMonthsLong.indexOf(match[2]) + 1;
    if (month) return ymd(fullYear(match[3]), month, Number(match[1]));
  }
  return null;
}

export type ImportDay = { id: string; date: Date };
export type ImportItem = { row: number; ticket: string; email: string | null; dayIds: string[]; answers: Record<string, string | string[]> };
export type ImportProblem = { row: number; message: string };

/**
 * Turns the CSV rows (first row = headers) into registrants, or says which rows are wrong. Nothing is imported while
 * any problem remains, so a half-imported sheet can never happen.
 */
export function buildImport(input: { rows: string[][]; targets: ImportTarget[]; fields: RegistrationFieldConfig[]; days: ImportDay[]; seatMode: string }) {
  const problems: ImportProblem[] = [];
  const items: ImportItem[] = [];
  const [, ...body] = input.rows;
  const column = (target: ImportTarget) => input.targets.indexOf(target);
  const ticketColumn = column("ticket");
  const fieldsByKey = new Map(importableFields(input.fields).map((field) => [field.key, field]));
  const dayByDate = new Map(input.days.map((day) => [day.date.toISOString().slice(0, 10), day.id]));
  const wholeCourse = input.seatMode === "whole_course";
  const datesColumn = column("dates");

  if (ticketColumn < 0) problems.push({ row: 0, message: "ยังไม่ได้เลือกคอลัมน์ Ticket ID (รหัสใน QR)" });
  if (!wholeCourse && datesColumn < 0 && input.days.length !== 1) problems.push({ row: 0, message: "ยังไม่ได้เลือกคอลัมน์วันที่เข้าร่วม (โครงการนับที่นั่งรายวันและมีหลายวัน)" });
  for (const target of input.targets) if (target.startsWith("field:") && !fieldsByKey.has(target.slice(6))) problems.push({ row: 0, message: "มีคอลัมน์ที่จับคู่กับฟิลด์ที่ไม่มีในฟอร์มแล้ว — โหลดหน้าใหม่" });
  if (!body.length) problems.push({ row: 0, message: "ไฟล์ไม่มีข้อมูลผู้ลงทะเบียน" });
  if (body.length > IMPORT_MAX_ROWS) problems.push({ row: 0, message: `นำเข้าได้ครั้งละไม่เกิน ${IMPORT_MAX_ROWS.toLocaleString("en-US")} คน` });
  if (problems.length) return { items, problems };

  const seenTickets = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  body.forEach((cells, index) => {
    const row = index + 2; // spreadsheet row number: 1 is the header
    const cell = (at: number) => (at >= 0 ? cells[at] ?? "" : "").trim();
    const ticket = cell(ticketColumn).toUpperCase();
    if (!ticket) return problems.push({ row, message: "ไม่มี Ticket ID" });
    if (!TICKET.test(ticket)) return problems.push({ row, message: `Ticket ID “${ticket.slice(0, 40)}” ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข - และ _ (3–64 ตัว)` });
    if (seenTickets.has(ticket)) return problems.push({ row, message: `Ticket ID ${ticket} ซ้ำกับแถว ${seenTickets.get(ticket)}` });
    seenTickets.set(ticket, row);

    const rawEmail = cell(column("email")).toLowerCase();
    if (rawEmail && !z.email().max(191).safeParse(rawEmail).success) return problems.push({ row, message: `อีเมล “${rawEmail.slice(0, 60)}” ไม่ถูกต้อง` });
    if (rawEmail && seenEmails.has(rawEmail)) return problems.push({ row, message: `อีเมลซ้ำกับแถว ${seenEmails.get(rawEmail)}` });
    if (rawEmail) seenEmails.set(rawEmail, row);

    let dayIds: string[];
    if (wholeCourse) dayIds = input.days.map((day) => day.id);
    else if (datesColumn < 0) dayIds = input.days.map((day) => day.id);
    else {
      const parts = cell(datesColumn).split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
      if (!parts.length) return problems.push({ row, message: "ไม่มีวันที่เข้าร่วม" });
      const ids = new Set<string>();
      for (const part of parts) {
        const date = parseImportDate(part);
        const id = date ? dayByDate.get(date) : undefined;
        if (!id) return problems.push({ row, message: date ? `วันที่ “${part}” ไม่ใช่วันอบรมของโครงการนี้` : `อ่านวันที่ “${part}” ไม่ออก` });
        ids.add(id);
      }
      dayIds = [...ids];
    }

    const answers: Record<string, string | string[]> = {};
    input.targets.forEach((target, at) => {
      if (!target.startsWith("field:")) return;
      const field = fieldsByKey.get(target.slice(6))!;
      const value = cell(at);
      if (!value) return;
      if (field.type === "checkbox") answers[field.key] = value.split(/\s*,\s*/).filter(Boolean).map((item) => item.slice(0, 500));
      else if (field.type === "tel") answers[field.key] = normalizePhone(value).slice(0, answerMaxLength("tel"));
      else answers[field.key] = value.slice(0, answerMaxLength(field.type));
    });
    items.push({ row, ticket, email: rawEmail || null, dayIds, answers });
  });
  return { items, problems };
}
