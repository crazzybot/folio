/**
 * watcher.ts — Reports changes to the markdown files of the open workspace,
 * so the renderer can refresh the document list and the open document, and
 * to marks written by other processes (the MCP server, the VS Code
 * extension), so it can repaint them.
 *
 * One recursive fs.watch on the workspace folder, one on the marks folder.
 * Bursts of events (an editor's save writes, renames and touches several
 * files) are coalesced into a single notification.
 */

import fs from "node:fs";
import path from "node:path";
import { isRecordId } from "../../packages/core/src/marks";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const DEBOUNCE_MS = 150;

let watcher: fs.FSWatcher | null = null;
let timer: NodeJS.Timeout | undefined;

/**
 * Whether a change to `filename` (relative to the workspace) can affect the
 * document list or a document. Folders have no extension, and a renamed or
 * deleted folder can take documents with it, so those count too.
 */
function isRelevant(filename: string | null, skipDirs: ReadonlySet<string>): boolean {
  if (filename === null) return true; // the platform didn't say which file
  const parts = filename.split(/[\\/]/);
  if (parts.slice(0, -1).some((part) => skipDirs.has(part))) return false;
  const name = parts[parts.length - 1] ?? "";
  if (skipDirs.has(name)) return false;
  const ext = path.extname(name).toLowerCase();
  return ext === "" || MARKDOWN_EXTENSIONS.has(ext);
}

/**
 * Watch `workspace`, calling `onChange` (debounced) after relevant changes.
 * Replaces any previous watch; pass null to stop watching.
 */
export function watchWorkspace(
  workspace: string | null,
  skipDirs: ReadonlySet<string>,
  onChange: () => void,
): void {
  watcher?.close();
  watcher = null;
  clearTimeout(timer);
  if (workspace === null) return;

  try {
    watcher = fs.watch(workspace, { recursive: true }, (_event, filename) => {
      if (!isRelevant(filename, skipDirs)) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, DEBOUNCE_MS);
    });
  } catch {
    // Missing or unreadable folder: the app still works, just without live reload
    return;
  }
  // E.g. the workspace folder itself was deleted
  watcher.on("error", () => {
    watcher?.close();
    watcher = null;
  });
}

/**
 * Watch the marks folder (created if missing), calling `onChange`
 * (debounced) when a record was changed by another process.
 * `changedOutside` tells the app's own writes apart: the app reports those
 * itself. Returns a function that stops watching.
 */
export function watchMarks(
  folder: string,
  changedOutside: (id: string) => Promise<boolean>,
  onChange: () => void,
): () => void {
  let marksWatcher: fs.FSWatcher;
  let marksTimer: NodeJS.Timeout | undefined;
  // Records with events since the last check; null: an event without a file name
  let pending = new Set<string | null>();

  const check = async () => {
    const ids = [...pending];
    pending = new Set();
    for (const id of ids) {
      if (id === null || (await changedOutside(id).catch(() => true))) {
        onChange();
        return;
      }
    }
  };

  try {
    fs.mkdirSync(folder, { recursive: true });
    marksWatcher = fs.watch(folder, (_event, filename) => {
      // A record's file is its id and .json; the temp files of a write are left out
      const id = filename === null ? null : filename.replace(/\.json$/, "");
      if (id !== null && (id === filename || !isRecordId(id))) return;
      pending.add(id);
      clearTimeout(marksTimer);
      marksTimer = setTimeout(() => void check(), DEBOUNCE_MS);
    });
  } catch {
    // An unwritable data folder: marks from other processes show on the next refresh
    return () => {};
  }
  marksWatcher.on("error", () => marksWatcher.close());
  return () => {
    clearTimeout(marksTimer);
    marksWatcher.close();
  };
}
