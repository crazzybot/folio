/**
 * dataSource.ts — Where documents and marks come from: the REST backend,
 * the desktop app's IPC bridge, or the live demo's bundle (demo/source.ts).
 * api.ts chooses one at startup.
 */

import type {
  Bookmark,
  BookmarkHeading,
  DocumentContent,
  DocumentMeta,
  Highlight,
  HighlightColor,
  MarksListing,
  SearchResult,
  TextAnchor,
} from "./types";

/** A new highlight: where it is, its colour and an optional note. */
export type NewHighlight = TextAnchor & { color: HighlightColor; note: string | null };
export type HighlightChanges = { color?: HighlightColor; note?: string | null };

export interface DataSource {
  listDocuments(): Promise<DocumentMeta[]>;
  listAttachments(): Promise<string[]>;
  searchDocuments(query: string): Promise<SearchResult[]>;
  /** `encoded`: the location with each segment URI-encoded. */
  workspaceFileUrl(encoded: string): string;
  getDocumentContent(id: string): Promise<DocumentContent>;
  marks: {
    list(): Promise<MarksListing>;
    addHighlight(docId: string, body: NewHighlight): Promise<Highlight>;
    updateHighlight(docId: string, highlightId: string, changes: HighlightChanges): Promise<Highlight>;
    deleteHighlight(docId: string, highlightId: string): Promise<void>;
    addBookmark(docId: string, heading: BookmarkHeading | null): Promise<Bookmark>;
    deleteBookmark(docId: string, bookmarkId: string): Promise<void>;
    relink(recordId: string, docId: string): Promise<void>;
    forget(recordId: string): Promise<void>;
  };
}
