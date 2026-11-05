// Copies the frontend production build into desktop/renderer, where the
// Electron main process serves it from (and electron-builder packages it).

import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "..", "frontend", "dist");
const target = join(root, "renderer");

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});

console.log(`Copied ${source} → ${target}`);
