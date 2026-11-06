/**
 * viewState.ts — View preferences the renderer remembers (sidebar width,
 * folder tree, reading width, font size…), kept in view-state.json.
 *
 * The renderer would use localStorage, but Chromium doesn't keep it for the
 * app's own app:// origin across restarts. So the page loads these once at
 * startup (synchronously, through preload.ts) and sends each change here.
 * Unlike settings.json, this is app state, not something to edit by hand.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// The page decides keys and values; keep what it can store bounded
const MAX_ENTRIES = 100;
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_LENGTH = 64 * 1024;
const SAVE_DELAY_MS = 300;

let values = new Map<string, string>();
let timer: NodeJS.Timeout | undefined;

function statePath(): string {
  return path.join(app.getPath("userData"), "view-state.json");
}

export function loadViewState(): void {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
    values = new Map(
      Object.entries(raw as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(0, MAX_ENTRIES),
    );
  } catch {
    // Missing or unreadable: defaults
  }
}

/** All values, for the page to read at startup. */
export function viewStateSnapshot(): Record<string, string> {
  return Object.fromEntries(values);
}

/** Store one value (ignored if it's not a short string key and string value). */
export function setViewState(key: unknown, value: unknown): void {
  if (typeof key !== "string" || typeof value !== "string") return;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || value.length > MAX_VALUE_LENGTH) return;
  if (!values.has(key) && values.size >= MAX_ENTRIES) return;
  if (values.get(key) === value) return;
  values.set(key, value);
  clearTimeout(timer);
  timer = setTimeout(saveViewState, SAVE_DELAY_MS);
}

/** Write pending changes now (also called on quit). */
export function saveViewState(): void {
  clearTimeout(timer);
  timer = undefined;
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(viewStateSnapshot(), null, 2) + "\n");
  } catch {
    // Not remembered this time
  }
}

/** Whether a change is still waiting to be written. */
export function hasPendingViewState(): boolean {
  return timer !== undefined;
}
