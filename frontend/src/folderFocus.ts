/**
 * folderFocus.ts — Focus on Folder: the document list, search and the
 * status bar count narrow to one folder of the workspace. The workspace
 * itself doesn't change, so links, images and document ids keep working.
 *
 * The narrowing itself is documentsInFolder (documentTree.ts).
 *
 * Remembered per workspace (storage.ts): the desktop app knows its
 * workspace folder; the live demo has one workspace.
 */

import { useCallback, useState } from "react";
import { recallForWorkspace, rememberForWorkspace } from "./workspaceMemory";

const FOCUS_KEY = "folio.folderFocus";

/** The focused folder (workspace-relative, null for the whole workspace) and its setter. */
export function useFolderFocus(): [string | null, (folder: string | null) => void] {
  const [focus, setFocus] = useState<string | null>(() => recallForWorkspace(FOCUS_KEY));
  const choose = useCallback((folder: string | null) => {
    const next = folder === "" ? null : folder;
    setFocus(next);
    rememberForWorkspace(FOCUS_KEY, next);
  }, []);
  return [focus, choose];
}
