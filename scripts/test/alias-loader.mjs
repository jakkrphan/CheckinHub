// Lets `node --test` load app TypeScript that imports "@/…" (tsconfig paths) or omits the ".ts" extension.
// Usage: node --import ./scripts/test/alias-loader.mjs --test …
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!globalThis.__checkinhubAliasLoader) {
  globalThis.__checkinhubAliasLoader = true;
  register(import.meta.url, { data: { src: pathToFileURL(fileURLToPath(new URL("../../src/", import.meta.url))).href } });
}

let srcUrl;
export function initialize(data) { srcUrl = data?.src; }

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && !path.endsWith("\\") && !path.endsWith("/") && /\.[cm]?[jt]sx?$/.test(path)) return url;
  for (const suffix of [".ts", ".tsx", "/index.ts"]) if (existsSync(path + suffix)) return pathToFileURL(path + suffix).href;
  return url;
}

export async function resolve(specifier, context, next) {
  if (srcUrl && specifier.startsWith("@/")) return { url: withExtension(new URL(specifier.slice(2), srcUrl).href), shortCircuit: true };
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    return { url: withExtension(new URL(specifier, context.parentURL).href), shortCircuit: true };
  }
  // Next's entry points ("next/headers", "next/server", …) have no package exports map, so Node needs the file name.
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  return next(specifier, context);
}
