import { randomUUID } from "node:crypto";

import { conditionMatches, maxFilesOf, parseRegistrationAnswers, type RegistrationFileAnswer, type RegistrationFieldConfig } from "@/features/events/registration-fields";
import { ATTACHMENT_KEY, deleteStoredFiles, openStoredFile, putFile } from "@/server/registrations/file-store";
import { fileStorageReady } from "@/server/registrations/upload-storage";

const maxUploadBytes = 5 * 1024 * 1024;
export const docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function allowedExtension(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  if (["image/jpeg", "jpeg", "jpe"].includes(normalized)) return "jpg";
  if (["application/pdf"].includes(normalized)) return "pdf";
  if (["image/png"].includes(normalized)) return "png";
  if (["image/webp"].includes(normalized)) return "webp";
  if ([docxContentType].includes(normalized)) return "docx";
  return normalized;
}

function sniffFileType(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { ext: "pdf", contentType: "application/pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", contentType: "image/webp" };
  // docx is a ZIP ("PK") whose entry names (stored uncompressed) include the main Word part.
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && bytes.includes("word/document.xml")) return { ext: "docx", contentType: docxContentType };
  return null;
}

function safeOriginalName(name: string) {
  return (name.split(/[\\/]/).pop() ?? "attachment").replace(/[\r\n\0]/g, "_").slice(0, 180) || "attachment";
}

/**
 * Stores the uploads of every visible file field. Types are checked from the bytes (magic numbers), must match the
 * extension and be allowed by the field. A field takes up to `maxFilesOf(field)` files; all uploads together stay
 * under 5 MB. On any failure every file written so far is removed.
 */
export async function storeLocalRegistrationFiles(fields: RegistrationFieldConfig[], formData: FormData) {
  const fileFields = fields.filter((field) => field.type === "file");
  if (fileFields.length === 0) return { ok: true as const, uploads: {}, keys: [] as string[] };
  if (!fileStorageReady()) return { ok: false as const, reason: "storage-unavailable" };

  const textAnswers = parseRegistrationAnswers(fields.filter((field) => field.type !== "file"), formData);
  if (!textAnswers) return { ok: false as const, reason: "invalid" };
  const uploads: Record<string, RegistrationFileAnswer | RegistrationFileAnswer[]> = {};
  const keys: string[] = [];
  let totalBytes = 0;
  const fail = async (reason: "invalid" | "storage-unavailable") => {
    await deleteLocalRegistrationFiles(keys);
    return { ok: false as const, reason };
  };

  try {
    for (const field of fileFields) {
      if (!conditionMatches(field, textAnswers)) continue;

      const chosen = formData.getAll(`answer:${field.key}`).filter((value): value is File => value instanceof File && value.size > 0);
      if (chosen.length === 0) continue;
      if (chosen.length > maxFilesOf(field)) return await fail("invalid");
      const stored: RegistrationFileAnswer[] = [];
      for (const value of chosen) {
        if (value.size > (field.maxFileSizeMb ?? 5) * 1024 * 1024 || value.size > maxUploadBytes) return await fail("invalid");
        totalBytes += value.size;
        if (totalBytes > maxUploadBytes) return await fail("invalid");

        const extension = allowedExtension(value.name.includes(".") ? value.name.slice(value.name.lastIndexOf(".") + 1) : "");
        const bytes = Buffer.from(await value.arrayBuffer());
        const detected = sniffFileType(bytes);
        const allowed = (field.acceptedFileTypes ?? []).map(allowedExtension);
        if (!detected || detected.ext !== extension || !allowed.includes(detected.ext)) return await fail("invalid");

        const storageKey = `${randomUUID()}.${detected.ext}`;
        await putFile(storageKey, bytes);
        keys.push(storageKey);
        stored.push({ storageKey, originalName: safeOriginalName(value.name), contentType: detected.contentType, size: value.size });
      }
      // Single-file fields keep the original object shape so older readers and answers stay compatible.
      uploads[field.key] = maxFilesOf(field) > 1 ? stored : stored[0];
    }
    return { ok: true as const, uploads, keys };
  } catch {
    return await fail("storage-unavailable");
  }
}

export async function deleteLocalRegistrationFiles(keys: string[]) {
  await deleteStoredFiles(keys.filter((key) => ATTACHMENT_KEY.test(key)));
}

/** An attachment as a stream (see file-store), or null when the key is not an attachment or the file is gone. */
export async function openLocalRegistrationFile(key: string) {
  return ATTACHMENT_KEY.test(key) ? openStoredFile(key) : null;
}
