/**
 * dataSource.ts — Where documents and marks come from: the desktop app's
 * IPC bridge, or the live demo's bundle (demo/source.ts). api.ts chooses
 * one at startup.
 */

import type {
  Bookmark,
  BookmarkHeading,
  DocumentContent,
  DocumentNote,
  DocumentMeta,
  DocumentRead,
  Highlight,
  HighlightColor,
  MarksListing,
  NoteState,
  SearchResult,
  SendDocument,
  SentRound,
  TextAnchor,
} from "./types";

/** A new highlight: where it is, its colour and an optional note. */
export type NewHighlight = TextAnchor & { color: HighlightColor; note: string | null };
/** `private` null: back to the default (private without a note, feedback with one). */
export type HighlightChanges = { color?: HighlightColor; note?: string | null; state?: NoteState; private?: boolean | null };
/** A document's note as set: both null (or blank) removes it. State and privacy carry over unless given. */
export type NoteChanges = { text: string | null; requestedStatus: string | null; state?: NoteState; private?: boolean | null };

export interface DataSource {
  listDocuments(): Promise<DocumentMeta[]>;
  listAttachments(): Promise<string[]>;
  searchDocuments(query: string): Promise<SearchResult[]>;
  /** `encoded`: the location with each segment URI-encoded. */
  workspaceFileUrl(encoded: string): string;
  getDocumentContent(id: string): Promise<DocumentContent>;
  /** Which version of each document was last read. */
  reads: {
    list(): Promise<DocumentRead[]>;
    /** Record that the version with `sha1` was read; refused when the document has changed since. */
    mark(docId: string, sha1: string): Promise<void>;
    /** Go back one read: changed again, or new when there was none before. */
    unmark(docId: string): Promise<void>;
    /** Mark every document under `folder` ("" for all) read at its current version. */
    markFolder(folder: string): Promise<void>;
  };
  marks: {
    list(): Promise<MarksListing>;
    addHighlight(docId: string, body: NewHighlight): Promise<Highlight>;
    updateHighlight(docId: string, highlightId: string, changes: HighlightChanges): Promise<Highlight>;
    deleteHighlight(docId: string, highlightId: string): Promise<void>;
    addBookmark(docId: string, heading: BookmarkHeading | null): Promise<Bookmark>;
    deleteBookmark(docId: string, bookmarkId: string): Promise<void>;
    /** Set the note on the document as a whole; resolves to it, or null when removed. */
    setNote(docId: string, note: NoteChanges): Promise<DocumentNote | null>;
    deleteNote(docId: string): Promise<void>;
    relink(recordId: string, docId: string): Promise<void>;
    forget(recordId: string): Promise<void>;
    /** Record a round of sent notes; with `markSent`, open notes become sent. */
    send(docs: readonly SendDocument[], markSent: boolean): Promise<SentRound>;
    /** Undo a round: it goes, and the notes it made sent are open again. */
    unsend(round: SentRound): Promise<void>;
    /** The user's reply to a highlight's note (highlightId null: the document's note); resolves to the note. */
    reply(docId: string, highlightId: string | null, text: string): Promise<Highlight | DocumentNote>;
    /** Record that the user saw a note's thread. */
    markSeen(docId: string, highlightId: string | null): Promise<void>;
  };
}
