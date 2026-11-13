/**
 * marks.ts — Highlights, notes and bookmarks, kept outside the workspace.
 *
 * Folio never writes to documents. Marks live in `<data dir>/marks/`
 * (~/.folio, %USERPROFILE%\.folio on Windows), one JSON record per
 * document, named by the SHA-1 of the document's normalised real path — so
 * a file keeps its marks whichever folder is opened as the workspace.
 *
 * Several processes write there: the desktop app, and the MCP server and the
 * VS Code extension, each with its own store. Each write replaces a whole
 * record atomically; a store can tell a record changed by another process
 * from its own writes (changedOutside).
 *
 * Tested against tests/fixtures/marks. See docs/design/marks.md.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COLORS, NOTE_STATES } from "./markTypes";
import type { Author, Bookmark, BookmarkHeading, Color, DocumentNote, Highlight, NoteState, Reply, Round, Thread } from "./markTypes";

export { COLORS, NOTE_STATES };
export type { Author, Bookmark, BookmarkHeading, Color, DocumentNote, Highlight, NoteState, Reply, Round };

// Note states, privacy and rounds (docs/design/sending-notes.md) are optional
// fields a version-1 app keeps as they are, so they don't need a new version:
// an outdated install still shows and changes these marks
export const VERSION = 1;
const MAX_EXACT = 20_000; // characters of highlighted text
const MAX_CONTEXT = 64; // characters of prefix / suffix
const MAX_NOTE = 10_000;
const MAX_HIGHLIGHTS = 1_000; // per document
const MAX_BOOKMARKS = 1_000; // per document
const MAX_HEADING_TEXT = 1_000;
const MAX_REQUESTED_STATUS = 40;
const MAX_ROUNDS = 5; // per document, the latest kept
const MAX_REPLIES = 100; // per note
const MAX_REPLY = 10_000; // characters
const MAX_NAME = 100; // an author's name or login

// Paths differ only by case on these platforms' default file systems
const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32";

export interface MarksRecord {
  version: number;
  path: string;
  fingerprint: { sha1: string; size: number; filename: string };
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** Absent when there's none. */
  documentNote?: DocumentNote;
  /** The latest rounds this document's notes were sent in, oldest first; absent when none. */
  rounds?: Round[];
}

/** A request the store refuses; `status` is the matching HTTP status (404, 409…). */
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
 * os.path.realpath does: records made by the former Python backend, up to
 * 0.4, keep their ids).
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

function noteState(value: unknown): NoteState {
  const found = NOTE_STATES.find((s) => s === value);
  if (found === undefined) throw new MarkError(400, `state must be one of ${NOTE_STATES.join(", ")}`);
  return found;
}

/** A `private` change: true or false as chosen, null to go back to the default. */
function privacy(value: unknown): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new MarkError(400, "private must be true, false or null");
}

/** `mark` with `state` and `private` as given (open and null are left out: they're the defaults). */
function withLoop<T extends { state?: NoteState; private?: boolean }>(
  mark: T,
  changes: { state?: NoteState; private?: boolean | null },
): T {
  const next = { ...mark };
  if (changes.state !== undefined) {
    if (changes.state === "open") delete next.state;
    else next.state = changes.state;
  }
  if (changes.private !== undefined) {
    if (changes.private === null) delete next.private;
    else next.private = changes.private;
  }
  return next;
}

function author(value: unknown): Author {
  if (!isObject(value)) throw new MarkError(400, "author must be an object");
  switch (value["kind"]) {
    case "user":
      return { kind: "user" };
    case "agent":
      return { kind: "agent", name: string(value["name"], "author.name", MAX_NAME, 1) };
    case "github":
      return { kind: "github", login: string(value["login"], "author.login", MAX_NAME, 1) };
    default:
      throw new MarkError(400, "author.kind must be user, agent or github");
  }
}

/** A reply body: `{author, text, addressed?}`. */
function replyBody(body: unknown): { author: Author; text: string; addressed: boolean } {
  if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
  const text = string(body["text"], "text", MAX_REPLY, 1);
  if (text.trim() === "") throw new MarkError(400, "text must not be blank");
  return { author: author(body["author"]), text, addressed: body["addressed"] === true };
}

/**
 * `mark` with `reply` added. Addressed: the author says it's done. Otherwise
 * the reply is a question, an objection or the user's answer, so the note is
 * open again, to go with the next round (a resolved one is reopened).
 */
function withReply<T extends Thread & { state?: NoteState; private?: boolean }>(
  mark: T,
  reply: Reply,
  addressed: boolean,
): T {
  const replies = mark.replies ?? [];
  if (replies.length >= MAX_REPLIES) throw new MarkError(409, `A note can have at most ${MAX_REPLIES} replies`);
  return { ...withLoop(mark, { state: addressed ? "addressed" : "open" }), replies: [...replies, reply] };
}

function requestedStatus(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = string(value, "requestedStatus", MAX_REQUESTED_STATUS).trim();
  if (/[\r\n]/.test(text)) throw new MarkError(400, "requestedStatus must be one line");
  return text === "" ? null : text;
}

/**
 * A PUT body's note: `{text, requestedStatus}`, each null (or blank) for
 * none, and optionally `state` and `private` (null: back to the default).
 */
function documentNoteBody(
  body: unknown,
): Pick<DocumentNote, "text" | "requestedStatus"> & { state?: NoteState; private?: boolean | null } {
  if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
  return {
    text: note(body["text"]),
    requestedStatus: requestedStatus(body["requestedStatus"]),
    ...("state" in body ? { state: noteState(body["state"]) } : {}),
    ...("private" in body ? { private: privacy(body["private"]) } : {}),
  };
}

/** A record's saved note, or null when it has none (or one this version can't read). */
export function storedNote(value: unknown): DocumentNote | null {
  if (!isObject(value)) return null;
  const { text, requestedStatus: status, created, updated, state, private: locked, ...unknown } = value;
  const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  if (typeof created !== "string" || typeof updated !== "string") return null;
  // Fields this version doesn't know are kept, as on a highlight
  const found: DocumentNote = { ...unknown, text: textOrNull(text), requestedStatus: textOrNull(status), created, updated };
  if (found.text === null && found.requestedStatus === null) return null;
  const known = NOTE_STATES.find((s) => s === state);
  if (known !== undefined && known !== "open") found.state = known;
  if (typeof locked === "boolean") found.private = locked;
  return found;
}

/** Whether a record still holds anything: a record without marks is removed. */
function hasMarks(record: MarksRecord): boolean {
  return record.highlights.length > 0 || record.bookmarks.length > 0 || storedNote(record.documentNote) !== null;
}

/** A note moved onto a document that has one: its comment added below, its status only if there's none. */
function mergedNote(dest: DocumentNote | null, moved: DocumentNote | null): DocumentNote | null {
  if (dest === null || moved === null) return dest ?? moved;
  return {
    ...dest,
    text: [dest.text, moved.text].filter((t): t is string => t !== null).join("\n\n") || null,
    requestedStatus: dest.requestedStatus ?? moved.requestedStatus,
    ...(dest.replies || moved.replies ? { replies: mergedReplies(dest.replies, moved.replies) } : {}),
    updated: now(),
  };
}

/** Two threads as one, in time order, at most MAX_REPLIES (the latest). */
function mergedReplies(a: readonly Reply[] = [], b: readonly Reply[] = []): Reply[] {
  return [...a, ...b].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-MAX_REPLIES);
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
  // What this store last left in each record it changed: its text, null if removed
  private readonly written = new Map<string, string | null>();

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
      await this.remove(id);
      return;
    }
    await fs.mkdir(this.folder, { recursive: true });
    const tmp = `${file.slice(0, -".json".length)}.${randomBytes(4).toString("hex")}.tmp`;
    const text = JSON.stringify(record, null, 2) + "\n";
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
    this.written.set(id, text);
  }

  private async remove(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true });
    this.written.set(id, null);
  }

  /**
   * Whether record `id` isn't as this store last left it: another process
   * changed or removed it. A record this store never changed counts as
   * changed. Not serialised with the store's own changes: a watcher asks
   * after a file event, once the write that caused it has finished.
   */
  async changedOutside(id: string): Promise<boolean> {
    let text: string | null;
    try {
      text = await fs.readFile(this.file(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return true;
      text = null;
    }
    // undefined (never changed here) differs from any text or null
    return this.written.get(id) !== text;
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
    const loop: { state?: NoteState; private?: boolean | null } = {};
    if ("state" in body) loop.state = noteState(body["state"]);
    if ("private" in body) loop.private = privacy(body["private"]);
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const old = find(record, highlightId);
      const highlight = { ...withLoop(old, loop), ...changes, updated: now() };
      const highlights = (record as MarksRecord).highlights.map((h) => (h === old ? highlight : h));
      await this.write(id, await refreshed({ ...(record as MarksRecord), highlights }, file));
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
    const { text, requestedStatus: status, ...loop } = documentNoteBody(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = (await this.writable(id)) ?? emptyRecord();
      const old = storedNote(record.documentNote);
      const time = now();
      // The state and privacy carry over an edit
      const saved =
        text === null && status === null
          ? null
          : withLoop({ ...old, text, requestedStatus: status, created: old?.created ?? time, updated: time }, loop);
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

  // ── Threads ──────────────────────────────────────────────────────────────

  /**
   * Add a reply (`{author, text, addressed?}`) to highlight `highlightId`'s
   * note, or with null to the note on the document as a whole. Resolves to
   * the note with its replies.
   */
  reply(file: string, highlightId: string | null, body: unknown): Promise<Highlight | DocumentNote> {
    const { author: by, text, addressed } = replyBody(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const reply: Reply = { id: randomBytes(8).toString("hex"), author: by, text, at: now() };
      if (highlightId === null) {
        const old = storedNote(record?.documentNote);
        if (record === null || old === null) throw new MarkError(404, "The document has no note");
        const note = { ...withReply(old, reply, addressed), updated: reply.at };
        await this.write(id, await refreshed(withNote(record, note), file));
        return note;
      }
      const old = find(record, highlightId);
      const highlight = { ...withReply(old, reply, addressed), updated: reply.at };
      const highlights = (record as MarksRecord).highlights.map((h) => (h === old ? highlight : h));
      await this.write(id, await refreshed({ ...(record as MarksRecord), highlights }, file));
      return highlight;
    });
  }

  /** Record that the user saw the thread of `highlightId` (null: the document's note) now. */
  markSeen(file: string, highlightId: string | null): Promise<void> {
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      const seen = now();
      // Not an edit: `updated` stays as it is
      if (highlightId === null) {
        const old = storedNote(record?.documentNote);
        if (record === null || old === null) throw new MarkError(404, "The document has no note");
        await this.write(id, await refreshed(withNote(record, { ...old, seen }), file));
        return;
      }
      const old = find(record, highlightId);
      const highlights = (record as MarksRecord).highlights.map((h) => (h === old ? { ...h, seen } : h));
      await this.write(id, await refreshed({ ...(record as MarksRecord), highlights }, file));
    });
  }

  // ── Sending notes ────────────────────────────────────────────────────────

  /**
   * Record that the document's notes `highlightIds` (and its note on the
   * whole, with `documentNote`) were sent in round `roundId`, copied or
   * (`via: "mcp"`) fetched by agent `client`; with `markSent`, open ones
   * become sent. Notes no longer there are left out.
   * Resolves to what became sent, for undoing it.
   */
  send(file: string, body: unknown): Promise<SentNotes> {
    const { roundId, highlightIds, documentNote, markSent, via, client } = sendBody(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      if (record === null) throw new MarkError(404, "The document has no notes");
      const wanted = new Set(highlightIds);
      const sent: SentNotes = { highlightIds: [], documentNote: false };
      const highlights = record.highlights.map((h) => {
        if (!wanted.has(h.id) || !markSent || (h.state ?? "open") !== "open") return h;
        sent.highlightIds.push(h.id);
        return withLoop(h, { state: "sent" });
      });
      let note = storedNote(record.documentNote);
      const noteSent = documentNote && note !== null;
      if (noteSent && markSent && (note?.state ?? "open") === "open") {
        note = withLoop(note as DocumentNote, { state: "sent" });
        sent.documentNote = true;
      }
      const round: Round = {
        id: roundId,
        at: now(),
        via,
        ...(client === undefined ? {} : { client }),
        sha1: (await fingerprint(file)).sha1,
        notes: record.highlights.filter((h) => wanted.has(h.id)).map((h) => h.id),
        ...(noteSent ? { documentNote: true } : {}),
      };
      const rounds = [...(record.rounds ?? []).filter((r) => r.id !== roundId), round].slice(-MAX_ROUNDS);
      await this.write(id, await refreshed(withNote({ ...record, highlights, rounds }, note), file));
      return sent;
    });
  }

  /** Undo `send`: the round goes, and the notes it made sent are open again (unless they changed since). */
  unsend(file: string, body: unknown): Promise<void> {
    const { roundId, highlightIds, documentNote } = sendBody(body);
    const id = recordId(file);
    return this.serially(async () => {
      const record = await this.writable(id);
      if (record === null) return;
      const reopen = new Set(highlightIds);
      const highlights = record.highlights.map((h) => (reopen.has(h.id) && h.state === "sent" ? withLoop(h, { state: "open" }) : h));
      let note = storedNote(record.documentNote);
      if (documentNote && note?.state === "sent") note = withLoop(note, { state: "open" });
      const { rounds: _old, ...rest } = record;
      const rounds = (record.rounds ?? []).filter((r) => r.id !== roundId);
      const next = rounds.length > 0 ? { ...rest, rounds } : rest;
      await this.write(id, await refreshed(withNote({ ...next, highlights }, note), file));
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
      const rounds = [...(dest.rounds ?? []), ...(source.rounds ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      if (rounds.length > 0) merged.rounds = rounds.slice(-MAX_ROUNDS);
      const note = mergedNote(storedNote(dest.documentNote), storedNote(source.documentNote));
      await this.write(target, await refreshed(withNote(merged, note), file));
      await this.remove(id);
    });
  }

  /** Delete record `id` and all its marks. */
  forget(id: string): Promise<void> {
    checkRecordId(id);
    return this.serially(async () => {
      if ((await this.read(id)) === null) throw new MarkError(404, `Marks '${id}' not found`);
      await this.remove(id);
    });
  }
}

/** What a send changed: the highlights (and the document's note) it made sent. */
export interface SentNotes {
  highlightIds: string[];
  documentNote: boolean;
}

/** A new round's id. */
export function newRoundId(): string {
  return randomBytes(8).toString("hex");
}

function sendBody(body: unknown): {
  roundId: string;
  highlightIds: string[];
  documentNote: boolean;
  markSent: boolean;
  via: Round["via"];
  client?: string;
} {
  if (!isObject(body)) throw new MarkError(400, "Expected a JSON object");
  const roundId = body["roundId"];
  if (typeof roundId !== "string" || !/^[0-9a-f]{16}$/.test(roundId)) throw new MarkError(400, "roundId must be 16 hex digits");
  const ids = body["highlightIds"] ?? [];
  if (!Array.isArray(ids) || ids.length > MAX_HIGHLIGHTS || !ids.every((h) => typeof h === "string")) {
    throw new MarkError(400, "highlightIds must be a list of highlight ids");
  }
  const via = body["via"] ?? "copy";
  if (via !== "copy" && via !== "mcp") throw new MarkError(400, "via must be copy or mcp");
  return {
    roundId,
    highlightIds: ids as string[],
    documentNote: body["documentNote"] === true,
    markSent: body["markSent"] !== false,
    via,
    ...(body["client"] === undefined ? {} : { client: string(body["client"], "client", MAX_NAME, 1) }),
  };
}

/** A record of a file in the workspace, with its id and location. */
export interface WorkspaceRecord {
  id: string;
  location: string;
  record: MarksRecord;
}

/** Whether `id` is one recordId makes: record ids name files. */
export function isRecordId(id: string): boolean {
  return /^[0-9a-f]{40}$/.test(id);
}

function checkRecordId(id: string): void {
  if (!isRecordId(id)) throw new MarkError(404, `Marks '${id}' not found`);
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
  /** The latest rounds its notes were sent in; absent when none. */
  rounds?: Round[];
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
 * what `marks:list` returns.
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
        ...(record.rounds !== undefined && record.rounds.length > 0 ? { rounds: record.rounds } : {}),
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
