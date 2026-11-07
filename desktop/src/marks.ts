/**
 * marks.ts — Highlights (and, later, bookmarks) kept outside the workspace.
 *
 * Folio never writes to documents. Marks live in `<data dir>/marks/`
 * (~/.folio, %USERPROFILE%\.folio on Windows), one JSON record per
 * document, named by the SHA-1 of the document's normalised real path — so
 * a file keeps its marks whichever folder is opened as the workspace, and
 * the desktop app and a local backend sharing the folder find the same
 * record.
 *
 * Same format and rules as backend/app/marks.py; both are tested against
 * tests/fixtures/marks. See docs/design/marks.md.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = 1;
export const COLORS = ["yellow", "green", "blue", "pink"] as const;
const MAX_EXACT = 20_000; // characters of highlighted text
const MAX_CONTEXT = 64; // characters of prefix / suffix
const MAX_NOTE = 10_000;
const MAX_HIGHLIGHTS = 1_000; // per document

// Paths differ only by case on these platforms' default file systems
const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32";

export type Color = (typeof COLORS)[number];

export interface Highlight {
  id: string;
  color: Color;
  note: string | null;
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
  created: string;
  updated: string;
}

export interface MarksRecord {
  version: number;
  path: string;
  fingerprint: { sha1: string; size: number; filename: string };
  bookmarks: unknown[];
  highlights: Highlight[];
}

/** A request the store refuses; `status` matches the backend's HTTP status. */
export class MarkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The default data folder: ~/.folio (%USERPROFILE%\.folio on Windows). */
export function defaultDataDir(): string {
  return path.join(os.homedir(), ".folio");
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Comparable form of a path: NFC (macOS may give NFD names), lower case where case doesn't matter. */
function normalise(p: string): string {
  const nfc = p.normalize("NFC");
  return CASE_INSENSITIVE ? nfc.toLowerCase() : nfc;
}

/** The path stored in a record: symlinks resolved, NFC. */
export function realPath(p: string): string {
  let real: string;
  try {
    real = realpathSync(p);
  } catch {
    real = path.resolve(p);
  }
  return real.normalize("NFC");
}

/** The record (file name) for the document at `p`. */
export function recordId(p: string): string {
  return createHash("sha1").update(normalise(realPath(p)), "utf8").digest("hex");
}

/** Comparable form of a workspace-relative location, to match records to scanned documents. */
export function locationKey(location: string): string {
  return normalise(location);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, name: string, maxLength: number, minLength = 0): string {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    throw new MarkError(400, `${name} must be a string of ${minLength}–${maxLength} characters`);
  }
  return value;
}

function offset(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MarkError(400, `${name} must be a non-negative integer`);
  }
  return value;
}

function color(value: unknown): Color {
  const found = COLORS.find((c) => c === value);
  if (found === undefined) throw new MarkError(400, `color must be one of ${COLORS.join(", ")}`);
  return found;
}

function note(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = string(value, "note", MAX_NOTE);
  return text.trim() === "" ? null : text;
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function newHighlight(body: unknown): Highlight {
  if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
  const { quote, position } = body;
  if (!isObject(quote) || !isObject(position)) throw new MarkError(400, "quote and position must be objects");
  const start = offset(position["start"], "position.start");
  const end = offset(position["end"], "position.end");
  if (end <= start) throw new MarkError(400, "position.end must be after position.start");
  const time = now();
  return {
    id: randomBytes(8).toString("hex"),
    color: color(body["color"]),
    note: note(body["note"]),
    quote: {
      exact: string(quote["exact"], "quote.exact", MAX_EXACT, 1),
      prefix: string(quote["prefix"] ?? "", "quote.prefix", MAX_CONTEXT),
      suffix: string(quote["suffix"] ?? "", "quote.suffix", MAX_CONTEXT),
    },
    position: { start, end },
    created: time,
    updated: time,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class MarksStore {
  readonly folder: string;
  // Changes are read–modify–write of one file: run them one at a time
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.folder = path.join(dataDir, "marks");
  }

  private file(id: string): string {
    return path.join(this.folder, `${id}.json`);
  }

  private serially<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queue.then(change);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** The record, null if there is none; a damaged one is refused rather than overwritten. */
  private async read(id: string): Promise<MarksRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      record = null;
    }
    if (!isObject(record) || !Array.isArray(record["highlights"])) {
      throw new MarkError(409, "This document's marks file is damaged; it was left as it is");
    }
    return record as unknown as MarksRecord;
  }

  private async writable(id: string): Promise<MarksRecord | null> {
    const record = await this.read(id);
    if (record !== null && record.version !== VERSION) {
      throw new MarkError(409, "These marks were saved by a newer version of Folio");
    }
    return record;
  }

  /** Save atomically (temp file, then rename); a record with no marks left is removed. */
  private async write(id: string, record: MarksRecord): Promise<void> {
    const file = this.file(id);
    if (record.highlights.length === 0 && record.bookmarks.length === 0) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(this.folder, { recursive: true });
    const tmp = `${file.slice(0, -".json".length)}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  }

  /** Every readable record of this version (others are left alone). */
  async records(): Promise<MarksRecord[]> {
    let names: string[];
    try {
      names = (await fs.readdir(this.folder)).filter((name) => name.endsWith(".json")).sort();
    } catch {
      return [];
    }
    const found: MarksRecord[] = [];
    for (const name of names) {
      try {
        const record: unknown = JSON.parse(await fs.readFile(path.join(this.folder, name), "utf8"));
        if (isObject(record) && record["version"] === VERSION && typeof record["path"] === "string") {
          found.push(record as unknown as MarksRecord);
        }
      } catch {
        // Unreadable: skipped
      }
    }
    return found;
  }

  /** Records of documents inside `workspace`, by location key (see locationKey). */
  async inWorkspace(workspace: string): Promise<Map<string, MarksRecord>> {
    const root = realPath(workspace);
    const prefix = normalise(root) + path.sep;
    const found = new Map<string, MarksRecord>();
    for (const record of await this.records()) {
      if (normalise(record.path).startsWith(prefix)) {
        const location = record.path.slice(root.length + 1).split(path.sep).join("/");
        found.set(locationKey(location), record);
      }
    }
    return found;
  }

  addHighlight(file: string, content: string, body: unknown): Promise<Highlight> {
    const highlight = newHighlight(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = (await this.writable(id)) ?? emptyRecord();
      if (record.highlights.length >= MAX_HIGHLIGHTS) {
        throw new MarkError(409, `A document can have at most ${MAX_HIGHLIGHTS} highlights`);
      }
      record.highlights.push(highlight);
      await this.write(id, refreshed(record, file, content));
      return highlight;
    });
  }

  updateHighlight(file: string, content: string, highlightId: string, body: unknown): Promise<Highlight> {
    if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
    // Validate before changing anything
    const changes: Partial<Pick<Highlight, "color" | "note">> = {};
    if ("color" in body) changes.color = color(body["color"]);
    if ("note" in body) changes.note = note(body["note"]);
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const highlight = find(record, highlightId);
      Object.assign(highlight, changes, { updated: now() });
      await this.write(id, refreshed(record as MarksRecord, file, content));
      return highlight;
    });
  }

  deleteHighlight(file: string, content: string, highlightId: string): Promise<void> {
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const highlight = find(record, highlightId);
      const rest = (record as MarksRecord).highlights.filter((h) => h !== highlight);
      await this.write(id, refreshed({ ...(record as MarksRecord), highlights: rest }, file, content));
    });
  }
}

function emptyRecord(): MarksRecord {
  return { version: VERSION, path: "", fingerprint: { sha1: "", size: 0, filename: "" }, bookmarks: [], highlights: [] };
}

function find(record: MarksRecord | null, highlightId: string): Highlight {
  const highlight = record?.highlights.find((h) => h.id === highlightId);
  if (highlight === undefined) throw new MarkError(404, `Highlight '${highlightId}' not found`);
  return highlight;
}

/** The record with its path and fingerprint (used to re-link moved files) brought up to date. */
function refreshed(record: MarksRecord, file: string, content: string): MarksRecord {
  const data = Buffer.from(content, "utf8");
  return {
    version: VERSION,
    path: realPath(file),
    fingerprint: { sha1: createHash("sha1").update(data).digest("hex"), size: data.length, filename: path.basename(file) },
    bookmarks: record.bookmarks ?? [],
    highlights: record.highlights,
  };
}

export interface DocumentMarks {
  docId: string;
  location: string;
  highlights: Highlight[];
}

/**
 * Marks of the listed `documents` (a workspace scan) that have any, in list
 * order — what GET /api/marks returns.
 */
export async function listMarks(
  store: MarksStore,
  workspace: string,
  documents: readonly { id: string; location: string }[],
): Promise<{ documents: DocumentMarks[] }> {
  const records = await store.inWorkspace(workspace);
  const listed: DocumentMarks[] = [];
  for (const doc of documents) {
    const record = records.get(locationKey(doc.location));
    if (record !== undefined && record.highlights.length > 0) {
      listed.push({ docId: doc.id, location: doc.location, highlights: record.highlights });
    }
  }
  return { documents: listed };
}
