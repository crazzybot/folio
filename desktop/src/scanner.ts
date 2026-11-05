/**
 * scanner.ts — Discovers and catalogues markdown files under the workspace folder.
 *
 * Port of backend/app/scanner.py: IDs, titles and ordering match the Python
 * backend so deep links (/doc/<id>) are interchangeable between the two.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root, forward-slash separated
  title: string;
  created: string; // ISO-8601
}

export interface DocumentContent {
  id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ATX_HEADING = /^#{1,6}\s+(.+)/m;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
// Titles come from the top of the file; don't read huge files whole
const TITLE_SCAN_BYTES = 64 * 1024;

/** SHA-1 of the normalised relative path string; full 40-char hex. */
function stableId(relativePath: string): string {
  return createHash("sha1").update(relativePath, "utf8").digest("hex");
}

/**
 * Return a human-readable title for the file using this priority:
 *   1. First ATX heading  (# Title)
 *   2. First non-empty line
 *   3. Filename without extension
 */
async function extractTitle(filePath: string): Promise<string> {
  const stem = path.basename(filePath, path.extname(filePath));
  let text: string;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(TITLE_SCAN_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, TITLE_SCAN_BYTES, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return stem;
  }

  const match = ATX_HEADING.exec(text);
  if (match?.[1] !== undefined) return match[1].trim();

  for (const line of text.split(/\r\n|\r|\n/)) {
    const stripped = line.trim();
    if (stripped) return stripped;
  }

  return stem;
}

/**
 * Whether a directory entry is a file. Symlinks count only when they point
 * at a file inside the workspace — a shared folder must not be able to
 * surface e.g. `notes.md -> ~/.ssh/id_rsa`.
 */
async function isFileEntry(entry: Dirent, fullPath: string, realWorkspace: string): Promise<boolean> {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    const target = await fs.realpath(fullPath);
    if (!target.startsWith(realWorkspace + path.sep)) return false;
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function walk(
  workspace: string,
  realWorkspace: string,
  dir: string,
  skipDirs: ReadonlySet<string>,
  results: DocumentMeta[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Like os.walk(followlinks=False): never descend into symlinked folders.
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        await walk(workspace, realWorkspace, fullPath, skipDirs, results);
      }
      continue;
    }

    if (!MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (!(await isFileEntry(entry, fullPath, realWorkspace))) continue;

    try {
      const location = path.relative(workspace, fullPath).split(path.sep).join("/");
      const stat = await fs.stat(fullPath);
      results.push({
        id: stableId(location),
        filename: entry.name,
        location,
        title: await extractTitle(fullPath),
        created: new Date(stat.ctimeMs).toISOString(),
      });
    } catch {
      // Skip files we cannot stat
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recursively scan `workspace` for markdown files, sorted by `location`.
 * `skipDirs` holds folder **names** pruned from the walk entirely.
 * Returns an empty list when the workspace does not exist.
 */
export async function scanWorkspace(
  workspace: string,
  skipDirs: ReadonlySet<string> = new Set(),
): Promise<DocumentMeta[]> {
  let realWorkspace: string;
  try {
    realWorkspace = await fs.realpath(workspace);
  } catch {
    return [];
  }
  const results: DocumentMeta[] = [];
  await walk(workspace, realWorkspace, workspace, skipDirs, results);
  results.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
  return results;
}

/** Return the metadata and raw content of the document with `docId`, or null. */
export async function findDocument(
  workspace: string,
  docId: string,
  skipDirs: ReadonlySet<string> = new Set(),
): Promise<{ meta: DocumentMeta; content: string } | null> {
  const docs = await scanWorkspace(workspace, skipDirs);
  const meta = docs.find((doc) => doc.id === docId);
  if (meta === undefined) return null;
  try {
    const content = await fs.readFile(path.join(workspace, meta.location), "utf8");
    return { meta, content };
  } catch {
    return null;
  }
}
