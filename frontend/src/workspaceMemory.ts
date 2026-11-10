/**
 * workspaceMemory.ts — A value remembered per workspace (storage.ts), such
 * as the focused folder or the last open document: the desktop app knows
 * its workspace folder; the browser version has one workspace per server.
 */

import { getItem, setItem } from "./storage";

// Workspaces remembered, most recent last
const MAX_REMEMBERED_WORKSPACES = 50;

/** Saved values per workspace; unreadable or malformed storage counts as none. */
function loadMap(storageKey: string): Map<string, string> {
  try {
    const saved: unknown = JSON.parse(getItem(storageKey) ?? "{}");
    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return new Map();
    return new Map(
      Object.entries(saved as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
      ),
    );
  } catch {
    return new Map();
  }
}

/** The workspace values are remembered for: its folder in the desktop app, "" in the browser. */
function workspaceKey(): string {
  return window.markdownApi?.workspacePath ?? "";
}

/** The value remembered under `storageKey` for this workspace, if any. */
export function recallForWorkspace(storageKey: string): string | null {
  return loadMap(storageKey).get(workspaceKey()) ?? null;
}

/** Remember `value` under `storageKey` for this workspace; null forgets it. */
export function rememberForWorkspace(storageKey: string, value: string | null): void {
  const map = loadMap(storageKey);
  const workspace = workspaceKey();
  // Re-adding moves it to the end: the most recently used survive the cap
  map.delete(workspace);
  if (value !== null && value !== "") map.set(workspace, value);
  setItem(storageKey, JSON.stringify(Object.fromEntries([...map].slice(-MAX_REMEMBERED_WORKSPACES))));
}
