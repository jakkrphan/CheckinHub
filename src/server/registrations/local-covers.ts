import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const uploadRoot = join(process.cwd(), ".local-uploads");
const maxCoverBytes = 3 * 1024 * 1024;

export async function storeLocalCover(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return { ok: true as const, key: null };
  if (process.env.NODE_ENV === "production" || value.size > maxCoverBytes) return { ok: false as const };

  const bytes = Buffer.from(await value.arrayBuffer());
  let extension: "jpg" | "png" | "webp" | null = null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) extension = "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) extension = "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") extension = "webp";
  const declaredExtension = value.name.split(".").pop()?.toLowerCase();
  const matches = extension && (extension === "jpg" ? ["jpg", "jpeg"] : [extension]).includes(declaredExtension ?? "");
  if (!extension || !matches) return { ok: false as const };

  const key = `${randomUUID()}.${extension}`;
  await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(uploadRoot, key), bytes, { flag: "wx", mode: 0o600 });
  return { ok: true as const, key };
}

export async function deleteLocalCover(key: string | null | undefined) {
  if (!key || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key)) return;
  try { await unlink(join(uploadRoot, key)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
