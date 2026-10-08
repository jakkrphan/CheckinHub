import { copyFile, mkdir, open, readdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { uploadRoot } from "@/server/registrations/upload-storage";

// The one place that touches stored files (attachments and cover images). Everything else passes keys, so moving
// to object storage (S3 / MinIO) later means replacing this module only. Keys are random names we generated;
// anything else is refused, so a key from the database can never reach outside the upload folder.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A registrant's upload: `<uuid>.pdf|jpg|png|webp|docx`. */
export const ATTACHMENT_KEY = new RegExp(`^${UUID}\\.(pdf|jpg|png|webp|docx)$`, "i");
/** An event's cover: `<uuid>.webp` (or jpg/png from before covers were re-encoded). */
export const COVER_KEY = new RegExp(`^${UUID}\\.(jpg|png|webp)$`, "i");
/** A cover's small version: `<uuid>.thumb.webp`. */
export const THUMB_KEY = new RegExp(`^${UUID}\\.thumb\\.webp$`, "i");
const isKey = (key: string) => ATTACHMENT_KEY.test(key) || THUMB_KEY.test(key); // covers are a subset of attachment keys

/** Filesystem work on many files runs this many at a time, so a big folder cannot exhaust file handles. */
const PARALLEL = 50;
async function inChunks<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += PARALLEL) results.push(...await Promise.all(items.slice(start, start + PARALLEL).map(work)));
  return results;
}

function pathOf(key: string) {
  const root = uploadRoot();
  if (!root || !isKey(key)) return null;
  // turbopackIgnore (here and at every fs call): the folder is only known at runtime; without it the build traces the whole project.
  return join(/* turbopackIgnore: true */ root, key);
}

/** Writes a new file; never overwrites (keys are random, a clash is a bug). */
export async function putFile(key: string, bytes: Buffer) {
  const root = uploadRoot();
  const path = pathOf(key);
  if (!root || !path) throw new Error("File storage unavailable or invalid key");
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  await writeFile(/* turbopackIgnore: true */ path, bytes, { flag: "wx", mode: 0o600 });
}

/**
 * A stream for sending a file without loading it into memory, with its size for Content-Length. The file is opened
 * first, so one deleted a moment later still sends completely (the open handle keeps it readable) instead of a 200
 * that breaks off. Call `body.cancel()` if the stream will not be sent, so the file is closed.
 */
export async function openStoredFile(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const path = pathOf(key);
  if (!path) return null;
  let handle;
  try { handle = await open(/* turbopackIgnore: true */ path, "r"); } catch { return null; }
  try {
    const info = await handle.stat();
    if (!info.isFile()) { await handle.close(); return null; }
    return { body: Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>, size: info.size };
  } catch {
    await handle.close().catch(() => undefined);
    return null;
  }
}

/** Removes files; a file already gone is fine. */
export async function deleteStoredFiles(keys: (string | null | undefined)[]) {
  await inChunks(keys, async (key) => {
    const path = key ? pathOf(key) : null;
    if (!path) return;
    try { await unlink(/* turbopackIgnore: true */ path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}

/** Copies a file to a new key; false when the source no longer exists. */
export async function copyStoredFile(from: string, to: string) {
  const source = pathOf(from);
  const target = pathOf(to);
  if (!source || !target) return false;
  try {
    await copyFile(/* turbopackIgnore: true */ source, /* turbopackIgnore: true */ target);
    // Some systems keep the source's modification time on a copy; the orphan sweep must see the copy as new.
    const now = new Date();
    await utimes(/* turbopackIgnore: true */ target, now, now);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Every stored key with its last change, for the orphan sweep. Files that are not ours are left out (and alone). */
export async function listStoredFiles(): Promise<{ key: string; modifiedAt: Date }[]> {
  const root = uploadRoot();
  if (!root) return [];
  let names: string[];
  try { names = await readdir(/* turbopackIgnore: true */ root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await inChunks(names.filter(isKey), async (key) => {
    try {
      const info = await stat(join(/* turbopackIgnore: true */ root, key));
      return info.isFile() ? { key, modifiedAt: info.mtime } : null;
    } catch { return null; }
  });
  return files.filter((file): file is { key: string; modifiedAt: Date } => file !== null);
}

const OWNER_MARKER = ".checkinhub-folder";

/** The id written in the folder by the database that owns it (see upload-ownership.ts), or null when none. */
export async function readFolderOwner() {
  const root = uploadRoot();
  if (!root) return null;
  try { return (await readFile(join(/* turbopackIgnore: true */ root, OWNER_MARKER), "utf8")).trim() || null; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeFolderOwner(id: string) {
  const root = uploadRoot();
  if (!root) throw new Error("File storage unavailable");
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  await writeFile(join(/* turbopackIgnore: true */ root, OWNER_MARKER), `${id}\n`, { mode: 0o600 });
}
