/**
 * settings.ts — Persists user preferences as JSON in the app's userData
 * directory. Users edit the file directly (File → Settings…, like VS Code's
 * settings.json); changes are picked up while the app runs.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SKIP_DIRS, maxDepthSetting, skipDirsSetting } from "../../packages/core/src/settings";

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
  /**
   * File → Open in Editor: an app name on macOS ("Visual Studio Code"), a
   * command elsewhere ("code"); null picks one (see editor.ts).
   */
  editor: string | null;
}

// Shared with the MCP server, which scans the same folders
export { DEFAULT_SKIP_DIRS };

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  workspace: null,
  skipDirs: [...DEFAULT_SKIP_DIRS],
  maxDepth: null,
  theme: "system",
  editor: null,
};

export function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Validate each field, falling back to its default when missing or malformed. */
export function normalizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const workspace = typeof raw.workspace === "string" ? raw.workspace : null;
  const skipDirs = skipDirsSetting(raw.skipDirs);
  const maxDepth = maxDepthSetting(raw.maxDepth);
  const theme = isTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
  const editor = typeof raw.editor === "string" && raw.editor.trim() !== "" ? raw.editor.trim() : null;
  return {
    // Forget a workspace that has been deleted or moved since the last run
    workspace: workspace !== null && fs.existsSync(workspace) ? workspace : null,
    skipDirs,
    maxDepth,
    theme,
    editor,
  };
}

/** The settings on disk, or null if the file is missing or not valid JSON. */
function readSettingsFile(): Settings | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    return normalizeSettings(raw as Partial<Record<keyof Settings, unknown>>);
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
