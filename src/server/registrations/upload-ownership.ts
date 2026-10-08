import { randomUUID } from "node:crypto";

import { db } from "@/server/db";
import { readFolderOwner, writeFolderOwner } from "@/server/registrations/file-store";

// The orphan sweep deletes files this database does not refer to, which is only safe when the upload folder belongs to
// this database alone. Two systems pointed at one folder (staging and production sharing UPLOAD_DIR, two dev databases
// sharing .local-uploads) would otherwise delete each other's files. So the folder and the database carry the same
// random id: a SystemSetting row `upload-folder:<id>` (feature flags ignore unknown keys) and a marker file in the folder.

const PREFIX = "upload-folder:";

/**
 * "owned" when this database may sweep the folder. The first sweep claims an unmarked folder for its database; a folder
 * marked by another database — or a database already bound to another folder's id — is "shared" and never swept.
 */
export async function uploadFolderOwnership(): Promise<"owned" | "shared"> {
  const row = await db.systemSetting.findFirst({ where: { key: { startsWith: PREFIX } }, select: { key: true } });
  const marker = await readFolderOwner();
  if (!row) {
    if (marker) return "shared"; // another database already claimed this folder
    const id = randomUUID();
    await db.systemSetting.create({ data: { key: `${PREFIX}${id}`, enabled: true } });
    await writeFolderOwner(id);
    return "owned";
  }
  const id = row.key.slice(PREFIX.length);
  if (!marker) { await writeFolderOwner(id); return "owned"; } // e.g. the folder was restored without its marker
  return marker === id ? "owned" : "shared";
}
