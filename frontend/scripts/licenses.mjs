// Third-party license notices and the license allow-list, shared by the
// frontend build (vite.config.ts writes third-party-licenses.txt), the
// desktop app (desktop/scripts/copy-renderer.mjs adds its own dependencies
// and Electron) and CI (check-licenses.mjs). In frontend/, so the frontend's
// Docker build, which sees only this folder, has it too.
//
// Folio ships its dependencies' code, bundled and minified, so the notices
// their licenses ask to be kept with every copy travel in a file of their
// own.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** Licenses any dependency may use: permissive, notices only. */
export const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Python-2.0",
  "Unlicense",
]);

/**
 * Packages allowed although their license field alone wouldn't be, and why.
 * `license` is what Folio uses them under, shown in the notices.
 */
export const EXCEPTIONS = {
  elkjs: {
    license: "EPL-2.0",
    reason:
      "Offered under EPL-2.0 OR GPL-3.0-or-later; used under EPL-2.0. Mermaid's ELK layout, " +
      "distributed unmodified; its source is at https://github.com/kieler/elkjs",
  },
  khroma: {
    license: "MIT",
    reason: "No license field in package.json; its license file is MIT",
  },
};

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\b|[-._])/i;

function repositoryUrl(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!repo) return pkg.homepage ?? null;
  return repo
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/^([\w-]+\/[\w.-]+)$/, "https://github.com/$1");
}

function licenseField(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(" OR ");
  return null;
}

/** A package's name, version, license and license files' text, from its folder. */
export function readPackage(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const files = readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort();
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenseField(pkg),
    url: repositoryUrl(pkg),
    texts: files.map((name) => readFileSync(join(dir, name), "utf8").trim()),
  };
}

/** The package folder a bundled module belongs to, or null for Folio's own code. */
export function packageDirOf(moduleId) {
  const id = moduleId.replace(/^\0/, "").split("?")[0].split(sep).join("/");
  const at = id.lastIndexOf("/node_modules/");
  if (at === -1) return null;
  const rest = id.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0];
  return name ? id.slice(0, at + "/node_modules/".length + name.length) : null;
}

/** The folders of the production dependencies installed in `cwd` (npm ls). */
export function productionPackageDirs(cwd) {
  const out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  // The first line is the project itself
  return [...new Set(out.trim().split(/\r?\n/).slice(1))];
}

/** Whether a package's license is allowed, and the license Folio uses it under. */
export function checkLicense(pkg) {
  const exception = EXCEPTIONS[pkg.name];
  if (exception) return { ok: true, license: exception.license, note: exception.reason };
  if (pkg.license === null) return { ok: false, license: null, note: "no license field" };
  const expression = pkg.license.replace(/[()]/g, "").trim();
  // "A OR B": any one allowed will do; "A AND B": every one must be
  const ok = expression
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())));
  return { ok, license: pkg.license, note: null };
}

/** The notices for `packages`, one section each, sorted by name. */
export function formatNotices(title, packages) {
  const seen = new Set();
  const unique = packages
    .filter((p) => {
      const key = `${p.name}@${p.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rule = "-".repeat(78);
  const sections = unique.map((p) => {
    const { license, note } = checkLicense(p);
    const head = [`${p.name} ${p.version}`, `License: ${license ?? "unknown"}`];
    if (note && EXCEPTIONS[p.name]) head.push(note);
    if (p.url) head.push(p.url);
    const body = p.texts.length > 0 ? p.texts.join("\n\n") : `(No license file included; the package declares ${license ?? "no license"}.)`;
    return `${rule}\n${head.join("\n")}\n\n${body}\n`;
  });
  return `${title}\n\n${sections.join("\n")}`;
}
