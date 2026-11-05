/**
 * settings.ts — Persists user preferences as JSON in the app's userData
 * directory. Users edit the file directly (File → Settings…, like VS Code's
 * settings.json); changes are picked up while the app runs.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Theme = "system" | "light" | "dark";

const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

export interface Settings {
  /** Folder whose markdown files are listed; null until the user picks one. */
  workspace: string | null;
  /** Folder names skipped during scanning, wherever they appear. */
  skipDirs: string[];
  /** Folder levels below the workspace to scan ("docs/guide.md" is depth 1); null = unlimited. */
  maxDepth: number | null;
  /** Light or dark appearance; "system" follows the OS setting. */
  theme: Theme;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  workspace: null,
  skipDirs: [".git", "node_modules", ".venv", "__pycache__", ".cache"],
  maxDepth: null,
  theme: "system",
};

export function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Validate each field, falling back to its default when missing or malformed. */
function normalize(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const workspace = typeof raw.workspace === "string" ? raw.workspace : null;
  const skipDirs =
    Array.isArray(raw.skipDirs) && raw.skipDirs.every((name) => typeof name === "string")
      ? (raw.skipDirs as string[]).map((name) => name.trim()).filter(Boolean)
      : [...DEFAULT_SETTINGS.skipDirs];
  const maxDepth =
    typeof raw.maxDepth === "number" && Number.isInteger(raw.maxDepth) && raw.maxDepth > 0
      ? raw.maxDepth
      : null;
  const theme = isTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
  return {
    // Forget a workspace that has been deleted or moved since the last run
    workspace: workspace !== null && fs.existsSync(workspace) ? workspace : null,
    skipDirs,
    maxDepth,
    theme,
  };
}

/** The settings on disk, or null if the file is missing or not valid JSON. */
function readSettingsFile(): Settings | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    return normalize(raw as Partial<Record<keyof Settings, unknown>>);
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  return readSettingsFile() ?? { ...DEFAULT_SETTINGS, skipDirs: [...DEFAULT_SETTINGS.skipDirs] };
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n");
}

/**
 * Call `onChange` with the new settings whenever settings.json is saved.
 * Unparseable intermediate states (mid-edit) are ignored rather than
 * resetting everything to defaults.
 */
export function watchSettings(onChange: (settings: Settings) => void): void {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let timer: NodeJS.Timeout | undefined;
  // Watch the folder, not the file: editors often save by replacing the file
  fs.watch(path.dirname(file), (_event, filename) => {
    if (filename !== path.basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = readSettingsFile();
      if (next !== null) onChange(next);
    }, 200);
  });
}
