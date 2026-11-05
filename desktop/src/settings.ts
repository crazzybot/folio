/**
 * settings.ts — Persists user preferences (currently the workspace folder)
 * as JSON in the app's userData directory.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface Settings {
  workspace: string | null;
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<Settings>;
    const workspace = typeof raw.workspace === "string" ? raw.workspace : null;
    // Forget a workspace that has been deleted or moved since the last run
    return { workspace: workspace !== null && fs.existsSync(workspace) ? workspace : null };
  } catch {
    return { workspace: null };
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
