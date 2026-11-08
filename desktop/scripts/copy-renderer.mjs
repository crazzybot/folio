// Copies the frontend production build into desktop/renderer, where the
// Electron main process serves it from (and electron-builder packages it).
//
// The build's third-party-licenses.txt covers the frontend's packages; the
// desktop app's own production dependencies and Electron are added to it
// here (frontend/scripts/licenses.mjs), for Help → Third-Party Licenses.

import { appendFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatNotices, productionPackageDirs, readPackage } from "../../frontend/scripts/licenses.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "..", "frontend", "dist");
const target = join(root, "renderer");

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});

const notices = join(target, "third-party-licenses.txt");
if (!existsSync(notices)) throw new Error(`${notices} is missing: the frontend build should write it`);
const packages = [...productionPackageDirs(root), join(root, "node_modules", "electron")].map(readPackage);
appendFileSync(
  notices,
  "\n\n" +
    formatNotices(
      "The desktop app also includes the following. Electron is built on Chromium, whose own\n" +
        "notices are in LICENSES.chromium.html, shipped with the app.",
      packages,
    ),
);

console.log(`Copied ${source} → ${target}, with the desktop app's notices`);
