/**
 * files.ts — Opens a file a document links to ([report](report.pdf)) in the
 * system's default app.
 *
 * A document can link to anything, and documents aren't trusted (a cloned
 * repository could link to `install.command`), so only these kinds of file
 * open: documents, data, office files, images and media. Never HTML or SVG
 * (they'd run scripts from a local file), executables, scripts, launchers
 * (.command, .webloc, .app), archives, disk images or macro-enabled Office
 * files; not .key either (Keynote, but also private keys). The same list as
 * the backend's LINKED_FILE_TYPES (backend/app/scanner.py), plus images.
 */

import { shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export const LINKED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // documents and data
  ".pdf", ".txt", ".log", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".rtf", ".epub",
  // office
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".pages", ".numbers",
  // images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".heic", ".tif", ".tiff",
  // audio and video
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".mp4", ".m4v", ".mov", ".webm",
]);

export type OpenFileResult = "opened" | "not-allowed" | "not-found" | "failed";

/**
 * Open the file at workspace-relative `location` in its default app, if it's
 * an allowed type inside the workspace and outside skipped folders.
 */
export async function openLinkedFile(
  workspace: string | null,
  location: string,
  skipDirs: ReadonlySet<string>,
): Promise<OpenFileResult> {
  const parts = location.split("/");
  if (workspace === null || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) return "not-found";
  if (!LINKED_FILE_EXTENSIONS.has(path.extname(location).toLowerCase())) return "not-allowed";
  if (parts.slice(0, -1).some((part) => skipDirs.has(part))) return "not-found";

  let target: string;
  try {
    const [realWorkspace, realFile] = await Promise.all([fs.realpath(workspace), fs.realpath(path.join(workspace, ...parts))]);
    if (!realFile.startsWith(realWorkspace + path.sep) || !(await fs.stat(realFile)).isFile()) return "not-found";
    target = realFile;
  } catch {
    return "not-found";
  }
  // The resolved file must still be an allowed type (a symlink can rename it)
  if (!LINKED_FILE_EXTENSIONS.has(path.extname(target).toLowerCase())) return "not-allowed";
  return (await shell.openPath(target)) === "" ? "opened" : "failed";
}
