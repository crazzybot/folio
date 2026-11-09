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
import type { Bookmark, BookmarkHeading, DocumentMarks, DocumentNote, Highlight, MarksListing } from "../types";

export const STORAGE_KEY = "folio.demo.marks";
const VERSION = 1;

/** One document's marks, as stored. */
export interface StoredMarks {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** The note on the document as a whole; absent when there's none. */
  note?: DocumentNote;
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
    marks.note = { text, requestedStatus, created: marks.note?.created ?? time, updated: time };
    this.changed(docId);
    return structuredClone(marks.note);
  }

  deleteNote(docId: string): void {
    const marks = this.documents[docId];
    if (marks?.note === undefined) throw new Error("The document has no note");
    delete marks.note;
    this.changed(docId);
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
