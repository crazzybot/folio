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
import { IMAGE_TYPES } from "./images";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** A section heading, for searching titles and headings without reading files. */
export interface Heading {
  level: number; // 1-6
  text: string; // as rendered: no markdown syntax
}

export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root, forward-slash separated
  title: string;
  created: string; // ISO-8601
  headings: Heading[];
}

export interface ScanOptions {
  /** Folder **names** pruned from the walk entirely, e.g. "node_modules". */
  skipDirs?: ReadonlySet<string>;
  /** Folder levels below the workspace to scan ("docs/guide.md" is depth 1); unlimited if null. */
  maxDepth?: number | null;
}

export interface DocumentContent {
  id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
// Titles and headings come from the top of the file; don't read huge files whole
const HEAD_SCAN_BYTES = 256 * 1024;
const MAX_HEADINGS = 200;

// One heading line: "## Text", optional closing #s; up to 3 spaces of indent
const HEADING_LINE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
// An HTML heading on one line, as READMEs centre their title: <h1 align="center">Name</h1>
const HTML_HEADING_LINE = /^ {0,3}<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1\s*>/i;
const HTML_TAG = /<[^>]*>/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** SHA-1 of the normalised relative path string; full 40-char hex. */
export function stableId(relativePath: string): string {
  return createHash("sha1").update(relativePath, "utf8").digest("hex");
}

/** The start of the file (up to HEAD_SCAN_BYTES), or null if it can't be read. */
async function readHead(filePath: string): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(HEAD_SCAN_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, HEAD_SCAN_BYTES, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Heading text as rendered: link text instead of links, no emphasis or code markers. */
// YAML front matter at the very start of a file (as Obsidian, Jekyll, Hugo… write it)
const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const FRONT_MATTER_TITLE = /^title[ \t]*:[ \t]*(.+?)[ \t]*$/m;
const MAX_ATTACHMENTS = 10000;

/** The text after any front matter, and the front matter's `title:`, if set. */
export function splitFrontMatter(text: string): { body: string; title: string | null } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { body: text, title: null };
  const raw = FRONT_MATTER_TITLE.exec(match[1] ?? "")?.[1];
  const title = raw === undefined ? null : raw.replace(/^(["'])(.*)\1$/, "$2").trim() || null;
  return { body: text.slice(match[0].length), title };
}

/**
 * How a [[wiki link]] reads: its alias, else "Note > Heading", "Note" or
 * "Heading" (block references, #^id, are left out). Matches the viewer.
 */
export function wikiLinkText(inner: string): string {
  const bar = inner.indexOf("|");
  if (bar >= 0) return inner.slice(bar + 1).trim();
  const hash = inner.indexOf("#");
  const name = (hash >= 0 ? inner.slice(0, hash) : inner).trim();
  const heading = hash >= 0 && !inner.slice(hash + 1).startsWith("^") ? inner.slice(hash + 1).trim() : "";
  return name && heading ? `${name} > ${heading}` : name || heading;
}

function plainHeading(raw: string): string {
  return raw
    .replace(/!?\[\[([^\]]*)\]\]/g, (_match, inner: string) => wikiLinkText(inner))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ATX (# … ######) and one-line HTML headings outside fenced code blocks, in document order. */
export function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  for (const line of splitFrontMatter(text).body.split(/\r\n|\r|\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      const marker = fenceMatch[1];
      // A fence closes with the same character, at least as long
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    let level: number;
    let raw: string;
    const match = HEADING_LINE.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      level = match[1].length;
      raw = match[2];
    } else {
      const htmlMatch = HTML_HEADING_LINE.exec(line);
      if (htmlMatch?.[1] === undefined || htmlMatch[2] === undefined) continue;
      level = Number(htmlMatch[1]);
      raw = htmlMatch[2].replace(HTML_TAG, "");
    }
    const headingText = plainHeading(raw);
    if (headingText === "") continue;
    headings.push({ level, text: headingText });
    if (headings.length >= MAX_HEADINGS) break;
  }
  return headings;
}

/**
 * Return a human-readable title for the file using this priority:
 *   1. Front matter `title:`
 *   2. First heading  (# Title or <h1>Title</h1>, not in a code block)
 *   3. First non-empty line
 *   4. Filename without extension
 */
function extractTitle(text: string | null, stem: string): string {
  if (text === null) return stem;
  const { body, title } = splitFrontMatter(text);
  if (title !== null) return title;

  // As the heading reads: "About [[Note|the note]]" is "About the note"
  const first = extractHeadings(text)[0];
  if (first !== undefined) return first.text;

  for (const line of body.split(/\r\n|\r|\n/)) {
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

/** Build the DocumentMeta record for a file inside `workspace`. */
async function buildMeta(workspace: string, fullPath: string): Promise<DocumentMeta> {
  const location = path.relative(workspace, fullPath).split(path.sep).join("/");
  const [stat, head] = await Promise.all([fs.stat(fullPath), readHead(fullPath)]);
  return {
    id: stableId(location),
    filename: path.basename(fullPath),
    location,
    title: extractTitle(head, path.basename(fullPath, path.extname(fullPath))),
    created: new Date(stat.ctimeMs).toISOString(),
    headings: head === null ? [] : extractHeadings(head),
  };
}

// ---------------------------------------------------------------------------
// ID index
// Every scan records id -> location, so opening a document is a lookup plus
// one file read instead of a full re-walk of the workspace.
// ---------------------------------------------------------------------------

let indexKey: string | null = null;
let index = new Map<string, string>();

function indexKeyFor(workspace: string, { skipDirs = new Set(), maxDepth = null }: ScanOptions): string {
  return JSON.stringify([workspace, [...skipDirs].sort(), maxDepth]);
}

/**
 * Re-check an indexed path before reading it: the file may have been
 * removed, or a folder on its path swapped for a symlink, since the scan.
 */
async function isServable(
  workspace: string,
  location: string,
  { skipDirs = new Set(), maxDepth = null }: ScanOptions,
): Promise<boolean> {
  const folders = location.split("/").slice(0, -1);
  if (!MARKDOWN_EXTENSIONS.has(path.extname(location).toLowerCase())) return false;
  if (folders.some((part) => skipDirs.has(part))) return false;
  if (maxDepth !== null && folders.length > maxDepth) return false;
  try {
    const [realWorkspace, target] = await Promise.all([
      fs.realpath(workspace),
      fs.realpath(path.join(workspace, location)),
    ]);
    return target.startsWith(realWorkspace + path.sep) && (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function walk(
  workspace: string,
  realWorkspace: string,
  dir: string,
  depth: number,
  options: Required<ScanOptions>,
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
      const belowLimit = options.maxDepth === null || depth < options.maxDepth;
      if (belowLimit && !options.skipDirs.has(entry.name)) {
        await walk(workspace, realWorkspace, fullPath, depth + 1, options, results);
      }
      continue;
    }

    if (!MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (!(await isFileEntry(entry, fullPath, realWorkspace))) continue;

    try {
      results.push(await buildMeta(workspace, fullPath));
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
 * `options.skipDirs` holds folder **names** pruned from the walk entirely;
 * `options.maxDepth` caps how many folder levels deep the walk goes.
 * Returns an empty list when the workspace does not exist.
 */
export async function scanWorkspace(
  workspace: string,
  options: ScanOptions = {},
): Promise<DocumentMeta[]> {
  let realWorkspace: string;
  try {
    realWorkspace = await fs.realpath(workspace);
  } catch {
    return [];
  }
  const results: DocumentMeta[] = [];
  const resolved: Required<ScanOptions> = {
    skipDirs: options.skipDirs ?? new Set(),
    maxDepth: options.maxDepth ?? null,
  };
  await walk(workspace, realWorkspace, workspace, 0, resolved, results);
  results.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
  index = new Map(results.map((doc) => [doc.id, doc.location]));
  indexKey = indexKeyFor(workspace, options);
  return results;
}

/**
 * Return the metadata and raw content of the document with `docId`, or null.
 * Uses the index from the last scan; only an unknown id (a file added since,
 * or a cold start) triggers a full rescan.
 */
export async function findDocument(
  workspace: string,
  docId: string,
  options: ScanOptions = {},
): Promise<{ meta: DocumentMeta; content: string } | null> {
  const key = indexKeyFor(workspace, options);
  let location = indexKey === key ? index.get(docId) : undefined;
  if (location === undefined) {
    await scanWorkspace(workspace, options);
    location = index.get(docId);
    if (location === undefined) return null;
  }

  if (!(await isServable(workspace, location, options))) return null;
  const fullPath = path.join(workspace, location);
  try {
    const [meta, content] = await Promise.all([buildMeta(workspace, fullPath), fs.readFile(fullPath, "utf8")]);
    return { meta, content };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Attachments — images in the workspace, for ![[image.png]] embeds, which
// name a file without its folder. Same pruning as the document scan.
// ---------------------------------------------------------------------------

/** Workspace-relative locations of the image files in `workspace`, sorted. */
export async function scanAttachments(workspace: string, options: ScanOptions = {}): Promise<string[]> {
  let realWorkspace: string;
  try {
    realWorkspace = await fs.realpath(workspace);
  } catch {
    return [];
  }
  const skipDirs = options.skipDirs ?? new Set<string>();
  const maxDepth = options.maxDepth ?? null;
  const found: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_ATTACHMENTS) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((maxDepth === null || depth < maxDepth) && !skipDirs.has(entry.name)) await visit(fullPath, depth + 1);
        continue;
      }
      if (!(path.extname(entry.name).toLowerCase() in IMAGE_TYPES)) continue;
      if (!(await isFileEntry(entry, fullPath, realWorkspace))) continue;
      found.push(path.relative(workspace, fullPath).split(path.sep).join("/"));
    }
  }

  await visit(workspace, 0);
  return found.sort();
}
