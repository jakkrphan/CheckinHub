// Unit tests for stored files: cover re-encoding (WebP + thumbnail, metadata dropped), the key guard, and streaming.
// Runs against a throwaway UPLOAD_DIR, never the real upload folder.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

const folder = await mkdtemp(join(tmpdir(), "checkinhub-files-"));
process.env.UPLOAD_DIR = folder;
const { copyLocalCover, coverThumbKey, deleteLocalCover, storeLocalCover } = await import("./local-covers.ts");
const { isStoredKey, openStoredFile, readStoredFile } = await import("./file-store.ts");
test.after(() => rm(folder, { recursive: true, force: true }));

const photo = (width, height, format = "jpeg") => sharp({ create: { width, height, channels: 3, background: "#3a7" } })
  .withMetadata({ exif: { IFD0: { Make: "TestCam" } } })[format]().toBuffer();

test("a cover is stored as a ≤1600×900 WebP plus a 320×180 thumbnail, without the photo's metadata", async () => {
  const stored = await storeLocalCover(new File([await photo(4000, 2250)], "trip.jpg", { type: "image/jpeg" }));
  assert.equal(stored.ok, true);
  assert.match(stored.key, /^[0-9a-f-]{36}\.webp$/);
  const large = await sharp(await readStoredFile(stored.key)).metadata();
  const thumb = await sharp(await readStoredFile(coverThumbKey(stored.key))).metadata();
  assert.deepEqual([large.format, large.width, large.height, large.exif], ["webp", 1600, 900, undefined]);
  assert.deepEqual([thumb.format, thumb.width, thumb.height], ["webp", 320, 180]);
});

test("a small cover is not enlarged; copies and deletes take the thumbnail along", async () => {
  const stored = await storeLocalCover(new File([await photo(800, 450, "png")], "small.png", { type: "image/png" }));
  assert.equal((await sharp(await readStoredFile(stored.key)).metadata()).width, 800);
  const copy = await copyLocalCover(stored.key);
  assert.ok(await readStoredFile(coverThumbKey(copy)));
  await deleteLocalCover(stored.key);
  assert.equal(await readStoredFile(stored.key), null);
  assert.equal(await readStoredFile(coverThumbKey(stored.key)), null);
  assert.ok(await readStoredFile(copy), "deleting the original must not touch the copy");
});

test("non-images and wrong extensions are refused, and nothing is written", async () => {
  const before = (await readdir(folder)).length;
  assert.deepEqual(await storeLocalCover(new File([Buffer.from("%PDF-1.4 not an image")], "cover.jpg")), { ok: false });
  assert.deepEqual(await storeLocalCover(new File([await photo(100, 100)], "cover.gif")), { ok: false });
  // The signature decides: a PNG named .jpg never reaches the decoder.
  assert.deepEqual(await storeLocalCover(new File([await photo(100, 100, "png")], "cover.jpg")), { ok: false });
  assert.equal((await readdir(folder)).length, before);
});

test("a copied cover counts as new for the orphan sweep, even when the original is old", async () => {
  const stored = await storeLocalCover(new File([await photo(400, 225)], "old.jpg"));
  const monthAgo = new Date(Date.now() - 30 * 86400000);
  await utimes(join(folder, stored.key), monthAgo, monthAgo);
  const copy = await copyLocalCover(stored.key);
  assert.ok(Date.now() - (await stat(join(folder, copy))).mtime.getTime() < 60_000);
});

test("only keys we generate are accepted: no paths, no other names", async () => {
  for (const key of ["../.env.local", "..\\x.pdf", "a.pdf", "0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.exe", "/etc/passwd"]) {
    assert.equal(isStoredKey(key), false, key);
    assert.equal(await openStoredFile(key), null, key);
  }
  assert.equal(isStoredKey("0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.thumb.webp"), true);
});

test("a stored file streams with its size", async () => {
  const stored = await storeLocalCover(new File([await photo(400, 225)], "s.jpg"));
  const file = await openStoredFile(stored.key);
  const bytes = Buffer.from(await new Response(file.body).arrayBuffer());
  assert.equal(bytes.length, file.size);
});
