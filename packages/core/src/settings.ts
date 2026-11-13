/**
 * settings.ts — The parts of the desktop app's settings.json that other
 * processes read too: which folders a scan skips and how deep it goes, and
 * the opening line of review notes. The MCP server reads them so an agent
 * sees the documents the app lists, introduced as Copy review notes does.
 *
 * The app owns the file (desktop/src/settings.ts); this reads it without
 * Electron, from where Electron keeps it.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Folders never worth scanning: version control, dependencies, virtualenvs,
 * caches and tool data — large, and full of other projects' READMEs. Not
 * dist / build / vendor / target: some projects keep real documentation
 * there.
 */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".local",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".yarn",
  "bower_components",
  ".terraform",
  "Pods",
  ".gradle",
];

// The default before the list above. A saved list equal to it was never
// customised, so it's upgraded to the current default.
const PREVIOUS_DEFAULT_SKIP_DIRS = [".git", "node_modules", ".venv", "__pycache__", ".cache"];

function isPreviousDefault(names: readonly string[]): boolean {
  return names.length === PREVIOUS_DEFAULT_SKIP_DIRS.length && PREVIOUS_DEFAULT_SKIP_DIRS.every((n) => names.includes(n));
}

/** A saved `skipDirs`, or the default when it's missing, malformed or the previous default. */
export function skipDirsSetting(raw: unknown): string[] {
  const saved =
    Array.isArray(raw) && raw.every((name) => typeof name === "string")
      ? (raw as string[]).map((name) => name.trim()).filter(Boolean)
      : null;
  return saved === null || isPreviousDefault(saved) ? [...DEFAULT_SKIP_DIRS] : saved;
}

/** A saved `maxDepth`: a positive integer, else null (unlimited). */
export function maxDepthSetting(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

const MAX_REVIEW_INTRO = 2_000;

/** A saved `reviewIntroOn`: whether review notes start with instructions for the agent (default: yes). */
export function reviewIntroOnSetting(raw: unknown): boolean {
  return raw !== false;
}

/** A saved `reviewIntro`: its wording, or "" for the default. */
export function reviewIntroTextSetting(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, MAX_REVIEW_INTRO) : "";
}

/**
 * The opening line review notes start with, as the formatter takes it
 * (reviewNotes.ts): the wording, null when turned off, undefined for the
 * default.
 */
export function reviewIntroSetting(settings: Record<string, unknown>): string | null | undefined {
  if (!reviewIntroOnSetting(settings["reviewIntroOn"])) return null;
  const text = reviewIntroTextSetting(settings["reviewIntro"]);
  return text.trim() === "" ? undefined : text;
}

/**
 * The folder Electron gives the app for its data (`app.getPath("userData")`):
 * ~/Library/Application Support/Folio, %APPDATA%\Folio, ~/.config/Folio.
 */
export function appDataDir(appName = "Folio"): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", appName);
    case "win32":
      return path.join(process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"), appName);
    default:
      return path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config"), appName);
  }
}

/** The app's settings.json as saved, or an empty object if it's missing or unreadable (the app was never run). */
export function readAppSettings(file = path.join(appDataDir(), "settings.json")): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
