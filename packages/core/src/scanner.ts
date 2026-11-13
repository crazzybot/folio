/**
 * scanner.ts — Discovers and catalogues markdown files under the workspace folder.
 *
 * IDs, titles and ordering are fixed by tests/fixtures/expected-scan.json,
 * so deep links (/doc/<id>) keep working from one version to the next.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { extractHeadings, FENCE, FRONT_MATTER, HEADING_LINE, plainHeading, splitFrontMatter } from "./headings";
import type { Heading } from "./headings";
import { IMAGE_TYPES } from "./imageTypes";

export { extractHeadings, splitFrontMatter, wikiLinkText } from "./headings";
export type { Heading } from "./headings";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** What a document says about itself: front matter fields, or its status line. */
export interface Metadata {
  /** First word of the status, lowercased: "accepted", "superseded", "draft"… */
  status: string | null;
  /** The status as written, when it says more than that word ("superseded by ADR-0005"). */
  statusDetail: string | null;
  date: string | null;
  /** decision-makers (MADR 4) or deciders (MADR 3). */
  people: string[];
  /** Lowercased, without "#", no duplicates. */
  tags: string[];
  /**
   * The 1-based line the status is written on: front matter's `status:`, the
   * "Status:" line, or the Status section's first line; null without a status.
   */
  statusLine: number | null;
}

export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root, forward-slash separated
  title: string;
  created: string; // ISO-8601
  headings: Heading[];
  /** Left out when the document has none of its fields. */
  meta?: Metadata;
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
const MAX_ATTACHMENTS = 10000;
// Titles and headings come from the top of the file; don't read huge files whole
const HEAD_SCAN_BYTES = 256 * 1024;


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

// ---------------------------------------------------------------------------
// Metadata (docs/design/frontmatter-metadata.md)
// Not a YAML parser: the few forms these keys are written in
// (tests/fixtures/meta-cases.json).
// ---------------------------------------------------------------------------

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const MAX_PEOPLE = 20;

// A top-level key and its value: "status: accepted", "tags:" (a block list follows)
const FRONT_MATTER_KEY = /^([A-Za-z][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const QUOTED = /^(["'])(.*)\1$/;
const BLOCK_LIST_ITEM = /^[ \t]+-[ \t]+(.*?)[ \t]*$/;
// "Status: accepted", "* Status: accepted", "**Status:** accepted"
const STATUS_LINE = /^ {0,3}(?:[*+-][ \t]+)?(?:\*\*|__)?status(?:\*\*|__)?[ \t]*:(?:\*\*|__)?[ \t]*(.+?)[ \t]*$/i;

/** Top-level keys of front matter: a scalar's text, or a block list's items. First of each key wins. */
function frontMatterFields(block: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  const lines = block.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = FRONT_MATTER_KEY.exec(lines[i] ?? "");
    if (match?.[1] === undefined) continue;
    let value: string | string[] = match[2] ?? "";
    if (value === "") {
      const items: string[] = [];
      for (let item = BLOCK_LIST_ITEM.exec(lines[i + 1] ?? ""); item?.[1] !== undefined; item = BLOCK_LIST_ITEM.exec(lines[i + 1] ?? "")) {
        items.push(item[1]);
        i++;
      }
      if (items.length > 0) value = items;
    }
    if (!fields.has(match[1])) fields.set(match[1], value);
  }
  return fields;
}

/** The index of `key`'s line in front matter, or -1. */
function keyLine(block: string, key: string): number {
  return block.split(/\r\n|\r|\n/).findIndex((line) => FRONT_MATTER_KEY.exec(line)?.[1] === key);
}

/** A scalar's text: unquoted, without a trailing comment; null for anything but plain text. */
function scalar(raw: string): string | null {
  const value = raw.trim();
  const quoted = QUOTED.exec(value) ?? QUOTED.exec(value.replace(/[ \t]+#.*$/, ""));
  if (quoted?.[2] !== undefined) return quoted[2].trim() || null;
  const plain = value.replace(/[ \t]+#.*$/, "").trim();
  // Flow collections and block scalars aren't plain text
  if (plain === "" || /^[[{|>]/.test(plain)) return null;
  return plain;
}

/** A list's items: a block list, a flow list ("[a, b]") or comma-separated text. */
function list(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => scalar(item) ?? []);
  let value = raw.trim();
  if (!/["']/.test(value)) value = value.replace(/[ \t]+#.*$/, "");
  const flow = /^\[(.*)\](?:[ \t]+#.*)?$/.exec(value);
  if (flow?.[1] !== undefined) value = flow[1];
  else if (/^[{|>]/.test(value)) return [];
  return value.split(",").flatMap((item) => scalar(item) ?? []);
}

/** "superseded by ADR-0005" → status "superseded", detail as written; null when there's no word. */
function parseStatus(raw: string): Pick<Metadata, "status" | "statusDetail"> | null {
  const value = raw.replace(/[*`]/g, "").trim();
  const word = /^\S+/.exec(value)?.[0].replace(/[.,;:!]+$/, "").toLowerCase() ?? "";
  if (word === "") return null;
  const bare = value.replace(/[.,;:!]+$/, "").toLowerCase() === word;
  return { status: word, statusDetail: bare ? null : value };
}

type BodyStatus = Pick<Metadata, "status" | "statusDetail"> & { line: number };

/**
 * The status written in the first section: a "Status:" line before the
 * second heading, or a "## Status" section; `line` is its index in `body`.
 */
function bodyStatus(body: string): BodyStatus | null {
  let fence: string | null = null;
  let started = false; // past the first non-blank line
  let section: string[] | null = null; // the "Status" section's first paragraph, once inside it
  let sectionLine = -1;
  const lines = body.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      started = true;
      if (section !== null && section.length > 0) break;
      continue;
    }
    if (fence !== null) continue;
    const blank = line.trim() === "";
    if (section !== null) {
      if (blank ? section.length > 0 : HEADING_LINE.test(line)) break;
      if (!blank) {
        if (section.length === 0) sectionLine = index;
        section.push(line.trim());
      }
      continue;
    }
    if (blank) continue;
    const heading = HEADING_LINE.exec(line);
    if (heading?.[2] !== undefined) {
      // The heading the document starts with is its title; the next one ends the first section
      if (!started) {
        started = true;
        continue;
      }
      if (plainHeading(heading[2]).toLowerCase() !== "status") return null;
      section = [];
      continue;
    }
    started = true;
    const statusLine = STATUS_LINE.exec(line);
    if (statusLine?.[1] !== undefined) {
      const status = parseStatus(statusLine[1]);
      return status === null ? null : { ...status, line: index };
    }
  }
  const status = section === null || section.length === 0 ? null : parseStatus(section.join(" "));
  return status === null ? null : { ...status, line: sectionLine };
}

/** The document's metadata (see Metadata), or null when it has none. */
export function extractMeta(text: string): Metadata | null {
  const match = FRONT_MATTER.exec(text);
  const fields = frontMatterFields(match?.[1] ?? "");
  const rawStatus = fields.get("status");
  const frontStatus = typeof rawStatus === "string" ? parseStatus(scalar(rawStatus) ?? "") : null;
  // Lines are counted in the file: front matter's first line is the "---"
  const frontLines = match === null ? 0 : match[0].split(/\r\n|\r|\n/).length - 1;
  const fromBody = frontStatus === null ? bodyStatus(match === null ? text : text.slice(match[0].length)) : null;
  const status = frontStatus ?? fromBody;
  const statusLine =
    frontStatus !== null ? keyLine(match?.[1] ?? "", "status") + 2 : fromBody !== null ? frontLines + fromBody.line + 1 : null;
  const rawDate = fields.get("date");
  const tags = [
    ...new Set(
      list(fields.get("tags") ?? fields.get("tag"))
        .map((tag) => tag.replace(/^#+/, "").trim().toLowerCase())
        .filter((tag) => tag !== "" && tag.length <= MAX_TAG_LENGTH),
    ),
  ].slice(0, MAX_TAGS);
  const meta: Metadata = {
    status: status?.status ?? null,
    statusDetail: status?.statusDetail ?? null,
    date: typeof rawDate === "string" ? scalar(rawDate) : null,
    people: list(fields.get("decision-makers") ?? fields.get("deciders")).slice(0, MAX_PEOPLE),
    tags,
    statusLine,
  };
  const empty = meta.status === null && meta.date === null && meta.people.length === 0 && meta.tags.length === 0;
  return empty ? null : meta;
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
  const meta = head === null ? null : extractMeta(head);
  return {
    id: stableId(location),
    filename: path.basename(fullPath),
    location,
    title: extractTitle(head, path.basename(fullPath, path.extname(fullPath))),
    created: new Date(stat.ctimeMs).toISOString(),
    headings: head === null ? [] : extractHeadings(head),
    ...(meta === null ? {} : { meta }),
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
