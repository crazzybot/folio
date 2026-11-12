/**
 * demo/marks.ts — Highlights and bookmarks for the live demo, kept in the
 * visitor's browser instead of ~/.folio. They behave like the desktop
 * app's (desktop/src/marks.ts): the same shapes, an existing bookmark
 * returned rather than duplicated, a blank note removed.
 *
 * Nothing is shared, so there's no validation beyond what the UI already
 * ensures. The demo's documents never change, so there are never missing
 * documents, and relink / forget have nothing to do.
 *
 * Until the visitor changes something, the marks are the bundle's seed
 * marks; reset() brings them back. When storage is unavailable (blocked,
 * or private browsing that refuses writes) the marks are kept in memory
 * and last until the page is closed.
 */

import type { HighlightChanges, NewHighlight, NoteChanges } from "../dataSource";
import type {
  Bookmark,
  BookmarkHeading,
  DocumentMarks,
  DocumentNote,
  Highlight,
  MarksListing,
  NoteState,
  Round,
  SendDocument,
  SentRound,
} from "../types";

export const STORAGE_KEY = "folio.demo.marks";
const VERSION = 1;
const MAX_ROUNDS = 5;

/** One document's marks, as stored. */
export interface StoredMarks {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** The note on the document as a whole; absent when there's none. */
  note?: DocumentNote;
  /** The latest rounds its notes were sent in; absent when none. */
  rounds?: Round[];
}

/** What's kept under STORAGE_KEY. */
interface Saved {
  version: number;
  documents: Record<string, StoredMarks>;
}

/** The parts of Storage the store uses (localStorage, or a stand-in in tests). */
export type MarksStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function note(value: string | null | undefined): string | null {
  return value == null || value.trim() === "" ? null : value;
}

/** `mark` with a state and privacy change applied: open and null are the defaults, so they're left out. */
function applyLoop(mark: { state?: NoteState; private?: boolean }, changes: { state?: NoteState; private?: boolean | null }): void {
  if (changes.state !== undefined) {
    if (changes.state === "open") delete mark.state;
    else mark.state = changes.state;
  }
  if (changes.private !== undefined) {
    if (changes.private === null) delete mark.private;
    else mark.private = changes.private;
  }
}

function sameHeading(a: BookmarkHeading | null, b: BookmarkHeading | null): boolean {
  return a === null || b === null ? a === b : a.text === b.text && a.level === b.level && a.occurrence === b.occurrence;
}

export class DemoMarks {
  private documents: Record<string, StoredMarks>;
  private storage: MarksStorage | null;

  /**
   * @param listed  the demo's documents, for listing order and locations
   * @param seed    the marks a first visit starts with, by document id
   * @param storage where the marks are kept; null keeps them in memory
   */
  constructor(
    private readonly listed: readonly { id: string; location: string }[],
    private readonly seed: Readonly<Record<string, StoredMarks>>,
    storage: MarksStorage | null,
  ) {
    this.storage = storage;
    this.documents = this.load() ?? structuredClone(this.seed);
  }

  private load(): Record<string, StoredMarks> | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw == null) return null;
      const saved = JSON.parse(raw) as Saved;
      return saved.version === VERSION && typeof saved.documents === "object" ? saved.documents : null;
    } catch {
      return null; // Unreadable or damaged: start from the seed
    }
  }

  private save(): void {
    try {
      const saved: Saved = { version: VERSION, documents: this.documents };
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      this.storage = null; // From now on, in memory only
    }
  }

  private marksOf(docId: string): StoredMarks {
    return (this.documents[docId] ??= { bookmarks: [], highlights: [] });
  }

  /** Save, dropping a document with no marks left. */
  private changed(docId: string): void {
    const marks = this.documents[docId];
    if (marks !== undefined && marks.bookmarks.length === 0 && marks.highlights.length === 0 && marks.note === undefined) {
      delete this.documents[docId];
    }
    this.save();
  }

  private highlight(docId: string, highlightId: string): Highlight {
    const found = this.documents[docId]?.highlights.find((h) => h.id === highlightId);
    if (found === undefined) throw new Error(`Highlight '${highlightId}' not found`);
    return found;
  }

  /** The marks of the documents that have any, in document-list order. */
  list(): MarksListing {
    const documents: DocumentMarks[] = [];
    for (const { id, location } of this.listed) {
      const marks = this.documents[id];
      if (marks === undefined) continue;
      documents.push({ docId: id, location, ...structuredClone(marks) });
    }
    return { documents, missing: [] };
  }

  addHighlight(docId: string, body: NewHighlight): Highlight {
    const time = now();
    const highlight: Highlight = {
      id: newId(),
      color: body.color,
      note: note(body.note),
      quote: { ...body.quote },
      position: { ...body.position },
      created: time,
      updated: time,
    };
    this.marksOf(docId).highlights.push(highlight);
    this.changed(docId);
    return structuredClone(highlight);
  }

  updateHighlight(docId: string, highlightId: string, changes: HighlightChanges): Highlight {
    const highlight = this.highlight(docId, highlightId);
    if (changes.color !== undefined) highlight.color = changes.color;
    if ("note" in changes) highlight.note = note(changes.note);
    applyLoop(highlight, changes);
    highlight.updated = now();
    this.changed(docId);
    return structuredClone(highlight);
  }

  deleteHighlight(docId: string, highlightId: string): void {
    const highlight = this.highlight(docId, highlightId);
    const marks = this.marksOf(docId);
    marks.highlights = marks.highlights.filter((h) => h !== highlight);
    this.changed(docId);
  }

  /** Bookmark the document (`heading` null) or a heading; an existing bookmark is returned as it is. */
  addBookmark(docId: string, heading: BookmarkHeading | null): Bookmark {
    const marks = this.marksOf(docId);
    const existing = marks.bookmarks.find((b) => sameHeading(b.heading, heading));
    if (existing !== undefined) return structuredClone(existing);
    const bookmark: Bookmark = { id: newId(), heading: heading === null ? null : { ...heading }, created: now() };
    marks.bookmarks.push(bookmark);
    this.changed(docId);
    return structuredClone(bookmark);
  }

  deleteBookmark(docId: string, bookmarkId: string): void {
    const marks = this.documents[docId];
    if (marks === undefined || !marks.bookmarks.some((b) => b.id === bookmarkId)) {
      throw new Error(`Bookmark '${bookmarkId}' not found`);
    }
    marks.bookmarks = marks.bookmarks.filter((b) => b.id !== bookmarkId);
    this.changed(docId);
  }

  /** Set the document's note; both parts empty removes it (and resolves to null). */
  setNote(docId: string, changes: NoteChanges): DocumentNote | null {
    const marks = this.marksOf(docId);
    const text = note(changes.text);
    const requestedStatus = changes.requestedStatus?.trim() || null;
    if (text === null && requestedStatus === null) {
      delete marks.note;
      this.changed(docId);
      return null;
    }
    const time = now();
    marks.note = { ...marks.note, text, requestedStatus, created: marks.note?.created ?? time, updated: time };
    applyLoop(marks.note, changes);
    this.changed(docId);
    return structuredClone(marks.note);
  }

  deleteNote(docId: string): void {
    const marks = this.documents[docId];
    if (marks?.note === undefined) throw new Error("The document has no note");
    delete marks.note;
    this.changed(docId);
  }

  /** Record a round of sent notes, as the desktop store does; the demo has no file to fingerprint. */
  send(docs: readonly SendDocument[], markSent: boolean): SentRound {
    const roundId = newId();
    const sent: SendDocument[] = [];
    for (const doc of docs) {
      const marks = this.documents[doc.docId];
      if (marks === undefined) continue;
      const wanted = new Set(doc.highlightIds);
      const done: SendDocument = { docId: doc.docId, highlightIds: [], documentNote: false };
      for (const h of marks.highlights) {
        if (markSent && wanted.has(h.id) && (h.state ?? "open") === "open") {
          h.state = "sent";
          done.highlightIds.push(h.id);
        }
      }
      const noteSent = doc.documentNote && marks.note !== undefined;
      if (noteSent && markSent && marks.note !== undefined && (marks.note.state ?? "open") === "open") {
        marks.note.state = "sent";
        done.documentNote = true;
      }
      const round: Round = {
        id: roundId,
        at: now(),
        via: "copy",
        sha1: "",
        notes: marks.highlights.filter((h) => wanted.has(h.id)).map((h) => h.id),
        ...(noteSent ? { documentNote: true } : {}),
      };
      marks.rounds = [...(marks.rounds ?? []), round].slice(-MAX_ROUNDS);
      sent.push(done);
      this.changed(doc.docId);
    }
    return { roundId, documents: sent };
  }

  /** Undo a send: its round goes, and what it made sent is open again. */
  unsend(round: SentRound): void {
    for (const doc of round.documents) {
      const marks = this.documents[doc.docId];
      if (marks === undefined) continue;
      const reopen = new Set(doc.highlightIds);
      for (const h of marks.highlights) if (reopen.has(h.id) && h.state === "sent") delete h.state;
      if (doc.documentNote && marks.note?.state === "sent") delete marks.note.state;
      const rounds = (marks.rounds ?? []).filter((r) => r.id !== round.roundId);
      if (rounds.length > 0) marks.rounds = rounds;
      else delete marks.rounds;
      this.changed(doc.docId);
    }
  }

  /** Back to the seed marks: the visitor's own are removed. */
  reset(): void {
    this.documents = structuredClone(this.seed);
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // In memory only; the seed is already back
    }
  }
}
