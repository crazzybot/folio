/**
 * folderFocus.ts — Focus on Folder: the document list, search and the
 * status bar count narrow to one folder of the workspace. The workspace
 * itself doesn't change, so links, images and document ids keep working.
 *
 * The narrowing itself is documentsInFolder (documentTree.ts).
 *
 * Remembered per workspace (storage.ts): the desktop app knows its
 * workspace folder; the browser version has one workspace per server.
 */

import { useCallback, useState } from "react";
import { getItem, setItem } from "./storage";

const FOCUS_KEY = "folio.folderFocus";
// Workspaces remembered, most recent last
const MAX_REMEMBERED_WORKSPACES = 50;

/** Saved focus per workspace; unreadable or malformed storage counts as none. */
function loadFocusMap(): Map<string, string> {
  try {
    const saved: unknown = JSON.parse(getItem(FOCUS_KEY) ?? "{}");
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

function saveFocus(workspace: string, folder: string | null): void {
  const map = loadFocusMap();
  // Re-adding moves it to the end: the most recently used survive the cap
  map.delete(workspace);
  if (folder !== null) map.set(workspace, folder);
  setItem(FOCUS_KEY, JSON.stringify(Object.fromEntries([...map].slice(-MAX_REMEMBERED_WORKSPACES))));
}

/** The workspace focus is remembered for: its folder in the desktop app, "" in the browser. */
function workspaceKey(): string {
  return window.markdownApi?.workspacePath ?? "";
}

/** The focused folder (workspace-relative, null for the whole workspace) and its setter. */
export function useFolderFocus(): [string | null, (folder: string | null) => void] {
  const [focus, setFocus] = useState<string | null>(() => loadFocusMap().get(workspaceKey()) ?? null);
  const choose = useCallback((folder: string | null) => {
    const next = folder === "" ? null : folder;
    setFocus(next);
    saveFocus(workspaceKey(), next);
  }, []);
  return [focus, choose];
}
