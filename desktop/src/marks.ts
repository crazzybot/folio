/**
 * marks.ts — Highlights, notes and bookmarks, kept outside the workspace.
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
import { existsSync, promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = 1;
export const COLORS = ["yellow", "green", "blue", "pink"] as const;
const MAX_EXACT = 20_000; // characters of highlighted text
const MAX_CONTEXT = 64; // characters of prefix / suffix
const MAX_NOTE = 10_000;
const MAX_HIGHLIGHTS = 1_000; // per document
const MAX_BOOKMARKS = 1_000; // per document
const MAX_HEADING_TEXT = 1_000;
const MAX_REQUESTED_STATUS = 40;

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

/** A bookmarked heading: its text, level and which of the same-text, same-level headings. */
export interface BookmarkHeading {
  text: string;
  level: number;
  occurrence: number;
}

export interface Bookmark {
  id: string;
  /** null: the document itself. */
  heading: BookmarkHeading | null;
  created: string;
}

/** A note on the document as a whole: a comment and / or a status to change it to (document-notes.md). */
export interface DocumentNote {
  text: string | null;
  requestedStatus: string | null;
  created: string;
  updated: string;
}

export interface MarksRecord {
  version: number;
  path: string;
  fingerprint: { sha1: string; size: number; filename: string };
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** Absent when there's none. */
  documentNote?: DocumentNote;
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

/**
 * The path stored in a record: symlinks resolved, NFC. For a file that no
 * longer exists, the folders that do are still resolved (as Python's
 * os.path.realpath does), so its record id is the same in both stores.
 */
export function realPath(p: string): string {
  const missing: string[] = [];
  let existing = path.resolve(p);
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...missing.reverse()).normalize("NFC");
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return path.resolve(p).normalize("NFC");
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
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

function requestedStatus(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = string(value, "requestedStatus", MAX_REQUESTED_STATUS).trim();
  if (/[\r\n]/.test(text)) throw new MarkError(400, "requestedStatus must be one line");
  return text === "" ? null : text;
}

/** A PUT body's note: `{text, requestedStatus}`, each null (or blank) for none. */
function documentNoteBody(body: unknown): Pick<DocumentNote, "text" | "requestedStatus"> {
  if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
  return { text: note(body["text"]), requestedStatus: requestedStatus(body["requestedStatus"]) };
}

/** A record's saved note, or null when it has none (or one this version can't read). */
export function storedNote(value: unknown): DocumentNote | null {
  if (!isObject(value)) return null;
  const { text, requestedStatus: status, created, updated } = value;
  const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  if (typeof created !== "string" || typeof updated !== "string") return null;
  const found = { text: textOrNull(text), requestedStatus: textOrNull(status), created, updated };
  return found.text === null && found.requestedStatus === null ? null : found;
}

/** Whether a record still holds anything: a record without marks is removed. */
function hasMarks(record: MarksRecord): boolean {
  return record.highlights.length > 0 || record.bookmarks.length > 0 || storedNote(record.documentNote) !== null;
}

/** A note moved onto a document that has one: its comment added below, its status only if there's none. */
function mergedNote(dest: DocumentNote | null, moved: DocumentNote | null): DocumentNote | null {
  if (dest === null || moved === null) return dest ?? moved;
  return {
    text: [dest.text, moved.text].filter((t): t is string => t !== null).join("\n\n") || null,
    requestedStatus: dest.requestedStatus ?? moved.requestedStatus,
    created: dest.created,
    updated: now(),
  };
}

/** `record` with `note` as its document note (none for null). */
function withNote(record: MarksRecord, note: DocumentNote | null): MarksRecord {
  const { documentNote: _old, ...rest } = record;
  return note === null ? rest : { ...rest, documentNote: note };
}

function heading(value: unknown): BookmarkHeading | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new MarkError(400, "heading must be an object or null");
  const level = value["level"];
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 6) {
    throw new MarkError(400, "heading.level must be an integer from 1 to 6");
  }
  return {
    text: string(value["text"], "heading.text", MAX_HEADING_TEXT, 1),
    level,
    occurrence: offset(value["occurrence"] ?? 0, "heading.occurrence"),
  };
}

function sameHeading(a: BookmarkHeading | null, b: BookmarkHeading | null): boolean {
  return a === null || b === null ? a === b : a.text === b.text && a.level === b.level && a.occurrence === b.occurrence;
}

/** A parsed record that can be used: highlights and (if present) bookmarks are lists. */
function isRecord(value: unknown): value is MarksRecord {
  return (
    isObject(value) &&
    Array.isArray(value["highlights"]) &&
    (value["bookmarks"] === undefined || Array.isArray(value["bookmarks"]))
  );
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
    if (!isRecord(record)) throw new MarkError(409, "This document's marks file is damaged; it was left as it is");
    return { ...record, bookmarks: record.bookmarks ?? [] };
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
    if (!hasMarks(record)) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(this.folder, { recursive: true });
    const tmp = `${file.slice(0, -".json".length)}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  }

  /** Every readable record of this version, with its id (others are left alone). */
  async records(): Promise<[string, MarksRecord][]> {
    let names: string[];
    try {
      names = (await fs.readdir(this.folder)).filter((name) => name.endsWith(".json")).sort();
    } catch {
      return [];
    }
    const found: [string, MarksRecord][] = [];
    for (const name of names) {
      try {
        const record: unknown = JSON.parse(await fs.readFile(path.join(this.folder, name), "utf8"));
        if (isRecord(record) && record.version === VERSION && typeof record.path === "string") {
          found.push([name.slice(0, -".json".length), { ...record, bookmarks: record.bookmarks ?? [] }]);
        }
      } catch {
        // Unreadable: skipped
      }
    }
    return found;
  }

  /**
   * Records of files inside `workspace` (whether or not they still exist),
   * by location key (see locationKey).
   */
  async inWorkspace(workspace: string): Promise<Map<string, WorkspaceRecord>> {
    const root = realPath(workspace);
    const prefix = normalise(root) + path.sep;
    const found = new Map<string, WorkspaceRecord>();
    for (const [id, record] of await this.records()) {
      if (normalise(record.path).startsWith(prefix)) {
        const location = record.path.slice(root.length + 1).split(path.sep).join("/");
        found.set(locationKey(location), { id, location, record });
      }
    }
    return found;
  }

  addHighlight(file: string, body: unknown): Promise<Highlight> {
    const highlight = newHighlight(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = (await this.writable(id)) ?? emptyRecord();
      if (record.highlights.length >= MAX_HIGHLIGHTS) {
        throw new MarkError(409, `A document can have at most ${MAX_HIGHLIGHTS} highlights`);
      }
      record.highlights.push(highlight);
      await this.write(id, await refreshed(record, file));
      return highlight;
    });
  }

  updateHighlight(file: string, highlightId: string, body: unknown): Promise<Highlight> {
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
      await this.write(id, await refreshed(record as MarksRecord, file));
      return highlight;
    });
  }

  deleteHighlight(file: string, highlightId: string): Promise<void> {
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const highlight = find(record, highlightId);
      const rest = (record as MarksRecord).highlights.filter((h) => h !== highlight);
      await this.write(id, await refreshed({ ...(record as MarksRecord), highlights: rest }, file));
    });
  }

  /** Bookmark the document (`{heading: null}`) or a heading; an existing bookmark is returned as it is. */
  addBookmark(file: string, body: unknown): Promise<Bookmark> {
    if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
    const target = heading(body["heading"]);
    const id = recordId(file);
    return this.serially(async () => {
      const record = (await this.writable(id)) ?? emptyRecord();
      const existing = record.bookmarks.find((b) => sameHeading(b.heading, target));
      if (existing !== undefined) return existing;
      if (record.bookmarks.length >= MAX_BOOKMARKS) {
        throw new MarkError(409, `A document can have at most ${MAX_BOOKMARKS} bookmarks`);
      }
      const bookmark: Bookmark = { id: randomBytes(8).toString("hex"), heading: target, created: now() };
      record.bookmarks.push(bookmark);
      await this.write(id, await refreshed(record, file));
      return bookmark;
    });
  }

  deleteBookmark(file: string, bookmarkId: string): Promise<void> {
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const bookmark = record?.bookmarks.find((b) => b.id === bookmarkId);
      if (record === null || bookmark === undefined) throw new MarkError(404, `Bookmark '${bookmarkId}' not found`);
      const rest = record.bookmarks.filter((b) => b !== bookmark);
      await this.write(id, await refreshed({ ...record, bookmarks: rest }, file));
    });
  }

  // ── The document's note ──────────────────────────────────────────────────

  /** Set the document's note (`{text, requestedStatus}`); both null removes it. Returns it, or null. */
  setNote(file: string, body: unknown): Promise<DocumentNote | null> {
    const { text, requestedStatus: status } = documentNoteBody(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = (await this.writable(id)) ?? emptyRecord();
      const old = storedNote(record.documentNote);
      const time = now();
      const saved =
        text === null && status === null ? null : { text, requestedStatus: status, created: old?.created ?? time, updated: time };
      await this.write(id, await refreshed(withNote(record, saved), file));
      return saved;
    });
  }

  deleteNote(file: string): Promise<void> {
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      if (record === null || storedNote(record.documentNote) === null) throw new MarkError(404, "The document has no note");
      await this.write(id, await refreshed(withNote(record, null), file));
    });
  }

  // ── Moved and deleted documents ──────────────────────────────────────────

  /** Move record `id`'s marks to the document at `file`, merged with any it has. */
  relink(id: string, file: string): Promise<void> {
    checkRecordId(id);
    const target = recordId(file);
    return this.serially(async () => {
      const source = await this.writable(id);
      if (source === null) throw new MarkError(404, `Marks '${id}' not found`);
      if (target === id) return;
      const dest = (await this.writable(target)) ?? emptyRecord();
      const ids = new Set(dest.highlights.map((h) => h.id));
      const merged: MarksRecord = {
        ...dest,
        bookmarks: [
          ...dest.bookmarks,
          ...source.bookmarks.filter((b) => !dest.bookmarks.some((d) => sameHeading(d.heading, b.heading))),
        ],
        highlights: [...dest.highlights, ...source.highlights.filter((h) => !ids.has(h.id))],
      };
      const note = mergedNote(storedNote(dest.documentNote), storedNote(source.documentNote));
      await this.write(target, await refreshed(withNote(merged, note), file));
      await fs.rm(this.file(id), { force: true });
    });
  }

  /** Delete record `id` and all its marks. */
  forget(id: string): Promise<void> {
    checkRecordId(id);
    return this.serially(async () => {
      if ((await this.read(id)) === null) throw new MarkError(404, `Marks '${id}' not found`);
      await fs.rm(this.file(id), { force: true });
    });
  }
}

/** A record of a file in the workspace, with its id and location. */
export interface WorkspaceRecord {
  id: string;
  location: string;
  record: MarksRecord;
}

function checkRecordId(id: string): void {
  // Record ids name files: only what recordId makes
  if (!/^[0-9a-f]{40}$/.test(id)) throw new MarkError(404, `Marks '${id}' not found`);
}

function emptyRecord(): MarksRecord {
  return { version: VERSION, path: "", fingerprint: { sha1: "", size: 0, filename: "" }, bookmarks: [], highlights: [] };
}

function find(record: MarksRecord | null, highlightId: string): Highlight {
  const highlight = record?.highlights.find((h) => h.id === highlightId);
  if (highlight === undefined) throw new MarkError(404, `Highlight '${highlightId}' not found`);
  return highlight;
}

/** What identifies the file's content, to re-link its marks if it's moved: from its bytes, as stored. */
export async function fingerprint(file: string): Promise<MarksRecord["fingerprint"]> {
  const data = await fs.readFile(file);
  return { sha1: createHash("sha1").update(data).digest("hex"), size: data.length, filename: path.basename(file) };
}

/**
 * The record with its path and fingerprint brought up to date. Fields this
 * version doesn't know are kept, so a newer version's survive its changes.
 */
async function refreshed(record: MarksRecord, file: string): Promise<MarksRecord> {
  return {
    ...record,
    version: VERSION,
    path: realPath(file),
    fingerprint: await fingerprint(file),
    bookmarks: record.bookmarks,
    highlights: record.highlights,
  };
}

// ---------------------------------------------------------------------------
// Listing, with moved documents found again
// ---------------------------------------------------------------------------

export interface DocumentMarks {
  docId: string;
  location: string;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** Absent when there's none. */
  note?: DocumentNote;
}

export interface MissingMarks {
  recordId: string;
  location: string;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  note?: DocumentNote;
  /** The document the marks probably belong to now, if there's one. */
  suggestion: { docId: string; location: string } | null;
}

/** A listed document (a workspace scan's). */
interface ListedDocument {
  id: string;
  location: string;
  headings: readonly { text: string }[];
}

// Markdown punctuation and whitespace: a highlight's rendered text is looked
// for in a document's source with these collapsed to one space
const MARKUP = /[\s*_`~#>|[\]]+/g;

function plain(text: string): string {
  return text.replace(MARKUP, " ").trim().toLowerCase();
}

/** Whether most of the record's highlights and bookmarked headings are in the document. */
function evidence(record: MarksRecord, content: string, headings: ReadonlySet<string>): boolean {
  const text = plain(content);
  const checks = [
    ...record.highlights.map((h) => text.includes(plain(h.quote.exact))),
    ...record.bookmarks.flatMap((b) => (b.heading === null ? [] : [headings.has(b.heading.text)])),
  ];
  // Only a bookmark on the document itself: the same name is all there is to go by
  return checks.length === 0 || checks.filter(Boolean).length * 2 >= checks.length;
}

const filenameOf = (location: string) => location.slice(location.lastIndexOf("/") + 1);

/**
 * The marks of the listed `documents` (a workspace scan) that have any, in
 * list order, and the records of files in `workspace` that no longer exist —
 * what GET /api/marks returns.
 *
 * A missing file's marks move by themselves to the one unmarked document
 * with the same content (a file moved or renamed without edits). Failing
 * that, the one unmarked document with the same file name is suggested when
 * most of the marks are found in it.
 */
export async function listMarks(
  store: MarksStore,
  workspace: string,
  documents: readonly ListedDocument[],
): Promise<{ documents: DocumentMarks[]; missing: MissingMarks[] }> {
  const state = async () => {
    const found = await store.inWorkspace(workspace);
    const missing = [...found.values()].filter((entry) => !existsSync(entry.record.path));
    const unmarked = documents.filter((doc) => !found.has(locationKey(doc.location)));
    return { found, missing, unmarked };
  };
  let { found, missing, unmarked } = await state();
  if (missing.length > 0 && (await relinkUnedited(store, workspace, missing, unmarked))) {
    ({ found, missing, unmarked } = await state());
  }

  const listed: DocumentMarks[] = [];
  for (const doc of documents) {
    const record = found.get(locationKey(doc.location))?.record;
    if (record !== undefined && hasMarks(record)) {
      const note = storedNote(record.documentNote);
      listed.push({
        docId: doc.id,
        location: doc.location,
        bookmarks: record.bookmarks,
        highlights: record.highlights,
        ...(note === null ? {} : { note }),
      });
    }
  }

  const listedMissing: MissingMarks[] = [];
  for (const { id, location, record } of missing.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0))) {
    const filename = filenameOf(location).toLowerCase();
    const namesakes = unmarked.filter((doc) => filenameOf(doc.location).toLowerCase() === filename);
    let suggestion: MissingMarks["suggestion"] = null;
    const doc = namesakes.length === 1 ? namesakes[0] : undefined;
    if (doc !== undefined) {
      const content = await fs.readFile(path.join(workspace, ...doc.location.split("/")), "utf8").catch(() => null);
      if (content !== null && evidence(record, content, new Set(doc.headings.map((h) => h.text)))) {
        suggestion = { docId: doc.id, location: doc.location };
      }
    }
    const note = storedNote(record.documentNote);
    listedMissing.push({
      recordId: id,
      location,
      bookmarks: record.bookmarks,
      highlights: record.highlights,
      ...(note === null ? {} : { note }),
      suggestion,
    });
  }
  return { documents: listed, missing: listedMissing };
}

/** Move each missing file's marks to the one unmarked document with its content; true if any moved. */
async function relinkUnedited(
  store: MarksStore,
  workspace: string,
  missing: readonly WorkspaceRecord[],
  unmarked: readonly ListedDocument[],
): Promise<boolean> {
  // Missing files told apart by their content; two with the same content are left to the user
  const sha1s = missing.map((entry) => entry.record.fingerprint?.sha1);
  const wanted = new Map<string, WorkspaceRecord>();
  missing.forEach((entry, i) => {
    const sha1 = sha1s[i];
    if (sha1 && sha1s.filter((s) => s === sha1).length === 1) wanted.set(sha1, entry);
  });
  const sizes = new Set([...wanted.values()].map((entry) => entry.record.fingerprint.size));
  // Hash only documents of a size some missing file had
  const bySha1 = new Map<string, string[]>();
  for (const doc of unmarked) {
    const file = path.join(workspace, ...doc.location.split("/"));
    const size = await fs.stat(file).then((stat) => stat.size, () => -1);
    if (size > 0 && sizes.has(size)) {
      const { sha1 } = await fingerprint(file);
      bySha1.set(sha1, [...(bySha1.get(sha1) ?? []), file]);
    }
  }
  let moved = false;
  for (const [sha1, entry] of wanted) {
    const files = bySha1.get(sha1) ?? [];
    if (files.length === 1 && files[0] !== undefined) {
      await store.relink(entry.id, files[0]);
      moved = true;
    }
  }
  return moved;
}
