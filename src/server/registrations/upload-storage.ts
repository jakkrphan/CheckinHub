import { isAbsolute, join, resolve } from "node:path";

/**
 * Folder for attachments and cover images on this server's disk. Production stores files only when UPLOAD_DIR
 * names a private folder outside the app (never under public/); development falls back to `.local-uploads`.
 * null = no storage, so uploads are refused and events with file fields cannot open.
 * Callers mark `join(root, …)` with `turbopackIgnore`: the folder is only known at runtime, and without it the build
 * traces the whole project into the server output.
 */
export function uploadRoot(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.UPLOAD_DIR?.trim();
  if (configured) return isAbsolute(configured) ? configured : resolve(configured);
  return env.NODE_ENV === "production" ? null : join(process.cwd(), ".local-uploads");
}

export const fileStorageReady = () => uploadRoot() !== null;
