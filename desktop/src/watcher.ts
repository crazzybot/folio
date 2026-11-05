/**
 * watcher.ts — Reports changes to the markdown files of the open workspace,
 * so the renderer can refresh the document list and the open document.
 *
 * One recursive fs.watch on the workspace folder. Bursts of events (an
 * editor's save writes, renames and touches several files) are coalesced
 * into a single notification.
 */

import fs from "node:fs";
import path from "node:path";

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
