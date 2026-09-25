import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { conditionMatches, parseRegistrationAnswers, type RegistrationFileAnswer, type RegistrationFieldConfig } from "@/features/events/registration-fields";

const uploadRoot = join(process.cwd(), ".local-uploads");
const maxUploadBytes = 5 * 1024 * 1024;
const keyPattern = /^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i;

function allowedExtension(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  if (["image/jpeg", "jpeg", "jpe"].includes(normalized)) return "jpg";
  if (["application/pdf"].includes(normalized)) return "pdf";
  if (["image/png"].includes(normalized)) return "png";
  if (["image/webp"].includes(normalized)) return "webp";
  return normalized;
}

function sniffFileType(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { ext: "pdf", contentType: "application/pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}

function safeOriginalName(name: string) {
  return (name.split(/[\\/]/).pop() ?? "attachment").replace(/[\r\n\0]/g, "_").slice(0, 180) || "attachment";
}

export async function storeLocalRegistrationFiles(fields: RegistrationFieldConfig[], formData: FormData) {
  const fileFields = fields.filter((field) => field.type === "file");
  if (fileFields.length === 0) return { ok: true as const, uploads: {}, keys: [] as string[] };
  if (process.env.NODE_ENV === "production") return { ok: false as const, reason: "storage-unavailable" };

  const textAnswers = parseRegistrationAnswers(fields.filter((field) => field.type !== "file"), formData);
  if (!textAnswers) return { ok: false as const, reason: "invalid" };
  const uploads: Record<string, RegistrationFileAnswer> = {};
  const keys: string[] = [];
  let totalBytes = 0;

  try {
    for (const field of fileFields) {
      if (!conditionMatches(field, textAnswers)) continue;

      const value = formData.get(`answer:${field.key}`);
      if (!(value instanceof File) || value.size === 0) continue;
      if (value.size > (field.maxFileSizeMb ?? 5) * 1024 * 1024 || value.size > maxUploadBytes) {
        await deleteLocalRegistrationFiles(keys);
        return { ok: false as const, reason: "invalid" };
      }
      totalBytes += value.size;
      if (totalBytes > maxUploadBytes) {
        await deleteLocalRegistrationFiles(keys);
        return { ok: false as const, reason: "invalid" };
      }

      const extension = allowedExtension(value.name.includes(".") ? value.name.slice(value.name.lastIndexOf(".") + 1) : "");
      const bytes = Buffer.from(await value.arrayBuffer());
      const detected = sniffFileType(bytes);
      const allowed = (field.acceptedFileTypes ?? []).map(allowedExtension);
      if (!detected || detected.ext !== extension || !allowed.includes(detected.ext)) {
        await deleteLocalRegistrationFiles(keys);
        return { ok: false as const, reason: "invalid" };
      }

      const storageKey = `${randomUUID()}.${detected.ext}`;
      await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(uploadRoot, storageKey), bytes, { flag: "wx", mode: 0o600 });
      keys.push(storageKey);
      uploads[field.key] = { storageKey, originalName: safeOriginalName(value.name), contentType: detected.contentType, size: value.size };
    }
    return { ok: true as const, uploads, keys };
  } catch {
    await deleteLocalRegistrationFiles(keys);
    return { ok: false as const, reason: "storage-unavailable" };
  }
}

export async function deleteLocalRegistrationFiles(keys: string[]) {
  await Promise.all(keys.filter((key) => keyPattern.test(key)).map(async (key) => {
    try { await unlink(join(uploadRoot, key)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }));
}

export async function readLocalRegistrationFile(key: string) {
  if (!keyPattern.test(key)) return null;
  try { return await readFile(join(uploadRoot, key)); } catch {
    return null;
  }
}
