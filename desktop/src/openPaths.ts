/**
 * openPaths.ts — Paths the app is asked to open: from the command line
 * (`folio notes/`, `Folio.exe guide.md`), a second launch, Finder's Open
 * With / double-click (macOS open-file), or a drop onto the window.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export type PathKind = "folder" | "markdown" | "other" | "missing";

/**
 * File and folder arguments from a command line, resolved against `cwd`.
 * Skips the executable (and, when not packaged, the app path in
 * `electron .`) and every switch, including Chromium's and macOS's -psn_….
 */
export function pathsFromArgv(argv: readonly string[], cwd: string, isPackaged: boolean): string[] {
  return argv
    .slice(isPackaged ? 1 : 2)
    .filter((arg) => arg !== "" && !arg.startsWith("-"))
    .map((arg) => path.resolve(cwd, arg));
}

export async function classifyPath(target: string): Promise<PathKind> {
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) return "folder";
    if (stat.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(target).toLowerCase())) return "markdown";
    return "other";
  } catch {
    return "missing";
  }
}

/**
 * The workspace-relative location ("docs/guide.md") of `file`, or null when
 * it isn't inside `workspace`. Symlinks are resolved on both sides.
 */
export async function locationInWorkspace(file: string, workspace: string): Promise<string | null> {
  try {
    const [realFile, realWorkspace] = await Promise.all([fs.realpath(file), fs.realpath(workspace)]);
    if (!realFile.startsWith(realWorkspace + path.sep)) return null;
    return path.relative(realWorkspace, realFile).split(path.sep).join("/");
  } catch {
    return null;
  }
}
