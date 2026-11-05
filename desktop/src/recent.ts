/**
 * recent.ts — Remembers recently opened workspace folders for File → Open
 * Recent. Kept in its own recent.json (app state, not a preference) so
 * settings.json stays limited to what users edit by hand.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MAX_RECENT = 10;

function recentPath(): string {
  return path.join(app.getPath("userData"), "recent.json");
}

/** Recently opened folders, most recent first; folders that no longer exist are dropped. */
export function loadRecentWorkspaces(): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(recentPath(), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === "string" && fs.existsSync(item))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentWorkspaces(folders: string[]): void {
  fs.mkdirSync(path.dirname(recentPath()), { recursive: true });
  fs.writeFileSync(recentPath(), JSON.stringify(folders, null, 2) + "\n");
}

/** Move `folder` to the top of the list and return the new list. */
export function addRecentWorkspace(folders: string[], folder: string): string[] {
  const next = [folder, ...folders.filter((item) => item !== folder)].slice(0, MAX_RECENT);
  saveRecentWorkspaces(next);
  return next;
}

export function removeRecentWorkspace(folders: string[], folder: string): string[] {
  const next = folders.filter((item) => item !== folder);
  saveRecentWorkspaces(next);
  return next;
}

/** Forget every folder except `current`, so it still shows up once another is opened. */
export function clearRecentWorkspaces(current: string | null): string[] {
  const next = current !== null ? [current] : [];
  saveRecentWorkspaces(next);
  return next;
}
