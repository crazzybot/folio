import type { DataSource, HighlightChanges, NoteChanges } from "./dataSource";
import { createDemoSource } from "./demo/source";
import type {
  Bookmark,
  BookmarkHeading,
  DocumentContent,
  DocumentMeta,
  DocumentNote,
  Highlight,
  HighlightColor,
  MarksListing,
  SearchResult,
  TextAnchor,
} from "./types";

// ─── Desktop app (IPC) ────────────────────────────────────────────────────────

function desktopSource(api: NonNullable<Window["markdownApi"]>): DataSource {
  return {
    listDocuments: () => api.listDocuments(),
    listAttachments: () => api.listAttachments(),
    searchDocuments: (query) => api.searchDocuments(query),
    workspaceFileUrl: (encoded) => api.workspaceFileBaseUrl + encoded,
    getDocumentContent: (id) => api.getDocumentContent(id),
    marks: {
      list: () => api.marks.list(),
      addHighlight: (docId, body) => api.marks.addHighlight(docId, body),
      updateHighlight: (docId, highlightId, changes) => api.marks.updateHighlight(docId, highlightId, changes),
      deleteHighlight: (docId, highlightId) => api.marks.deleteHighlight(docId, highlightId),
      addBookmark: (docId, heading) => api.marks.addBookmark(docId, { heading }),
      deleteBookmark: (docId, bookmarkId) => api.marks.deleteBookmark(docId, bookmarkId),
      setNote: (docId, note) => api.marks.setNote(docId, note),
      deleteNote: (docId) => api.marks.deleteNote(docId),
      relink: (recordId, docId) => api.marks.relink(recordId, docId),
      forget: (recordId) => api.marks.forget(recordId),
    },
  };
}

// ─── Anywhere else ────────────────────────────────────────────────────────────

/** Folio's frontend opened outside the desktop app and the demo build, e.g. `npm run dev` in a browser. */
export const UNAVAILABLE_MESSAGE =
  "No documents here: Folio's frontend runs in the desktop app. For the live demo in a browser, run 'npm run dev:demo'.";

function unavailable(): Promise<never> {
  return Promise.reject(new Error(UNAVAILABLE_MESSAGE));
}

const unavailableSource: DataSource = {
  listDocuments: unavailable,
  listAttachments: unavailable,
  searchDocuments: unavailable,
  workspaceFileUrl: () => "",
  getDocumentContent: unavailable,
  marks: {
    list: unavailable,
    addHighlight: unavailable,
    updateHighlight: unavailable,
    deleteHighlight: unavailable,
    addBookmark: unavailable,
    deleteBookmark: unavailable,
    setNote: unavailable,
    deleteNote: unavailable,
    relink: unavailable,
    forget: unavailable,
  },
};

// In the desktop app the documents come over IPC; the live demo
// (`vite build --mode demo`) brings its own. Other builds leave the demo
// out: the mode is a constant, so its branch is dropped.
const demo = import.meta.env.MODE === "demo" ? createDemoSource(import.meta.env.BASE_URL) : null;
const source: DataSource = demo ?? (window.markdownApi ? desktopSource(window.markdownApi) : unavailableSource);

// ─── Documents ────────────────────────────────────────────────────────────────

export async function fetchDocuments(): Promise<DocumentMeta[]> {
  return source.listDocuments();
}

/** Workspace-relative paths of the image files, for ![[image.png]] embeds. */
export async function fetchAttachments(): Promise<string[]> {
  return source.listAttachments();
}

/** Documents whose text contains `query` (case-insensitive; at least 2 characters). */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  return source.searchDocuments(query);
}

/** URL of the workspace file at `location` (workspace-relative, "/"-separated). */
export function workspaceFileUrl(location: string): string {
  return source.workspaceFileUrl(location.split("/").map(encodeURIComponent).join("/"));
}

export async function fetchDocumentContent(id: string): Promise<DocumentContent> {
  return source.getDocumentContent(id);
}

// ─── Marks ────────────────────────────────────────────────────────────────────

/** Bookmarks and highlights of every document in the workspace that has any. */
export async function fetchMarks(): Promise<MarksListing> {
  return source.marks.list();
}

export async function addHighlight(
  docId: string,
  anchor: TextAnchor,
  color: HighlightColor,
  note: string | null = null,
): Promise<Highlight> {
  return source.marks.addHighlight(docId, { ...anchor, color, note });
}

export async function updateHighlight(docId: string, highlightId: string, changes: HighlightChanges): Promise<Highlight> {
  return source.marks.updateHighlight(docId, highlightId, changes);
}

export async function deleteHighlight(docId: string, highlightId: string): Promise<void> {
  return source.marks.deleteHighlight(docId, highlightId);
}

/** Bookmark a document (`heading` null) or one of its headings; returns the existing bookmark if there is one. */
export async function addBookmark(docId: string, heading: BookmarkHeading | null): Promise<Bookmark> {
  return source.marks.addBookmark(docId, heading);
}

export async function deleteBookmark(docId: string, bookmarkId: string): Promise<void> {
  return source.marks.deleteBookmark(docId, bookmarkId);
}

/** Set the note on a document as a whole; resolves to it, or null when both parts are empty (removed). */
export async function setDocumentNote(docId: string, note: NoteChanges): Promise<DocumentNote | null> {
  return source.marks.setNote(docId, note);
}

export async function deleteDocumentNote(docId: string): Promise<void> {
  return source.marks.deleteNote(docId);
}

/** Move a missing document's marks to `docId` (merged with any it has). */
export async function relinkMarks(recordId: string, docId: string): Promise<void> {
  return source.marks.relink(recordId, docId);
}

/** Delete a missing document's marks. */
export async function forgetMarks(recordId: string): Promise<void> {
  return source.marks.forget(recordId);
}

/** Live demo: back to the marks a first visit starts with. Elsewhere, nothing. */
export async function resetDemoMarks(): Promise<void> {
  await demo?.resetMarks();
}
