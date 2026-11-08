import type { DataSource, HighlightChanges } from "./dataSource";
import { createDemoSource } from "./demo/source";
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

const apiBase: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

// ─── REST backend ─────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function expectOk(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}

function marksUrl(docId: string, kind: "highlights" | "bookmarks", markId?: string): string {
  const base = `${apiBase}/api/documents/${encodeURIComponent(docId)}/${kind}`;
  return markId === undefined ? base : `${base}/${encodeURIComponent(markId)}`;
}

// JSON bodies only: the backend refuses other content types (no cross-site form posts)
function sendJson(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const httpSource: DataSource = {
  listDocuments: async () => handleResponse<DocumentMeta[]>(await fetch(`${apiBase}/api/documents`)),
  listAttachments: async () => handleResponse<string[]>(await fetch(`${apiBase}/api/attachments`)),
  searchDocuments: async (query) =>
    handleResponse<SearchResult[]>(await fetch(`${apiBase}/api/search?q=${encodeURIComponent(query)}`)),
  workspaceFileUrl: (encoded) => `${apiBase}/api/files/${encoded}`,
  getDocumentContent: async (id) =>
    handleResponse<DocumentContent>(await fetch(`${apiBase}/api/documents/${encodeURIComponent(id)}/content`)),
  marks: {
    list: async () => handleResponse<MarksListing>(await fetch(`${apiBase}/api/marks`)),
    addHighlight: async (docId, body) =>
      handleResponse<Highlight>(await fetch(marksUrl(docId, "highlights"), sendJson("POST", body))),
    updateHighlight: async (docId, highlightId, changes) =>
      handleResponse<Highlight>(await fetch(marksUrl(docId, "highlights", highlightId), sendJson("PATCH", changes))),
    deleteHighlight: async (docId, highlightId) =>
      expectOk(await fetch(marksUrl(docId, "highlights", highlightId), { method: "DELETE" })),
    addBookmark: async (docId, heading) =>
      handleResponse<Bookmark>(await fetch(marksUrl(docId, "bookmarks"), sendJson("POST", { heading }))),
    deleteBookmark: async (docId, bookmarkId) =>
      expectOk(await fetch(marksUrl(docId, "bookmarks", bookmarkId), { method: "DELETE" })),
    relink: async (recordId, docId) =>
      expectOk(await fetch(`${apiBase}/api/marks/${encodeURIComponent(recordId)}/relink`, sendJson("POST", { docId }))),
    forget: async (recordId) =>
      expectOk(await fetch(`${apiBase}/api/marks/${encodeURIComponent(recordId)}`, { method: "DELETE" })),
  },
};

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
      relink: (recordId, docId) => api.marks.relink(recordId, docId),
      forget: (recordId) => api.marks.forget(recordId),
    },
  };
}

// In the desktop app the documents come over IPC instead of the REST backend;
// the live demo (`vite build --mode demo`) brings its own. Other builds
// leave the demo out: the mode is a constant, so its branch is dropped.
const source: DataSource =
  import.meta.env.MODE === "demo"
    ? createDemoSource(import.meta.env.BASE_URL)
    : window.markdownApi
      ? desktopSource(window.markdownApi)
      : httpSource;

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

/** Move a missing document's marks to `docId` (merged with any it has). */
export async function relinkMarks(recordId: string, docId: string): Promise<void> {
  return source.marks.relink(recordId, docId);
}

/** Delete a missing document's marks. */
export async function forgetMarks(recordId: string): Promise<void> {
  return source.marks.forget(recordId);
}
