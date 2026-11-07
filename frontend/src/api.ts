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

// In the desktop app the documents come over IPC instead of the REST backend.
const desktopApi = window.markdownApi;

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDocuments(): Promise<DocumentMeta[]> {
  if (desktopApi) return desktopApi.listDocuments();
  const res = await fetch(`${apiBase}/api/documents`);
  return handleResponse<DocumentMeta[]>(res);
}

/** Workspace-relative paths of the image files, for ![[image.png]] embeds. */
export async function fetchAttachments(): Promise<string[]> {
  if (desktopApi) return desktopApi.listAttachments();
  const res = await fetch(`${apiBase}/api/attachments`);
  return handleResponse<string[]>(res);
}

/** Documents whose text contains `query` (case-insensitive; at least 2 characters). */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  if (desktopApi) return desktopApi.searchDocuments(query);
  const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(query)}`);
  return handleResponse<SearchResult[]>(res);
}

/** URL of the workspace file at `location` (workspace-relative, "/"-separated). */
export function workspaceFileUrl(location: string): string {
  const encoded = location.split("/").map(encodeURIComponent).join("/");
  if (desktopApi) return desktopApi.workspaceFileBaseUrl + encoded;
  return `${apiBase}/api/files/${encoded}`;
}

export async function fetchDocumentContent(id: string): Promise<DocumentContent> {
  if (desktopApi) return desktopApi.getDocumentContent(id);
  const res = await fetch(`${apiBase}/api/documents/${encodeURIComponent(id)}/content`);
  return handleResponse<DocumentContent>(res);
}

// ─── Marks ────────────────────────────────────────────────────────────────────

/** Bookmarks and highlights of every document in the workspace that has any. */
export async function fetchMarks(): Promise<MarksListing> {
  if (desktopApi) return desktopApi.marks.list();
  return handleResponse<MarksListing>(await fetch(`${apiBase}/api/marks`));
}

function marksUrl(docId: string, kind: "highlights" | "bookmarks", markId?: string): string {
  const base = `${apiBase}/api/documents/${encodeURIComponent(docId)}/${kind}`;
  return markId === undefined ? base : `${base}/${encodeURIComponent(markId)}`;
}

// JSON bodies only: the backend refuses other content types (no cross-site form posts)
function sendJson(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function addHighlight(
  docId: string,
  anchor: TextAnchor,
  color: HighlightColor,
  note: string | null = null,
): Promise<Highlight> {
  const body = { ...anchor, color, note };
  if (desktopApi) return desktopApi.marks.addHighlight(docId, body);
  return handleResponse<Highlight>(await fetch(marksUrl(docId, "highlights"), sendJson("POST", body)));
}

export async function updateHighlight(
  docId: string,
  highlightId: string,
  changes: { color?: HighlightColor; note?: string | null },
): Promise<Highlight> {
  if (desktopApi) return desktopApi.marks.updateHighlight(docId, highlightId, changes);
  return handleResponse<Highlight>(await fetch(marksUrl(docId, "highlights", highlightId), sendJson("PATCH", changes)));
}

export async function deleteHighlight(docId: string, highlightId: string): Promise<void> {
  if (desktopApi) return desktopApi.marks.deleteHighlight(docId, highlightId);
  const res = await fetch(marksUrl(docId, "highlights", highlightId), { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}

/** Bookmark a document (`heading` null) or one of its headings; returns the existing bookmark if there is one. */
export async function addBookmark(docId: string, heading: BookmarkHeading | null): Promise<Bookmark> {
  if (desktopApi) return desktopApi.marks.addBookmark(docId, { heading });
  return handleResponse<Bookmark>(await fetch(marksUrl(docId, "bookmarks"), sendJson("POST", { heading })));
}

export async function deleteBookmark(docId: string, bookmarkId: string): Promise<void> {
  if (desktopApi) return desktopApi.marks.deleteBookmark(docId, bookmarkId);
  const res = await fetch(marksUrl(docId, "bookmarks", bookmarkId), { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}

/** Move a missing document's marks to `docId` (merged with any it has). */
export async function relinkMarks(recordId: string, docId: string): Promise<void> {
  if (desktopApi) return desktopApi.marks.relink(recordId, docId);
  const res = await fetch(`${apiBase}/api/marks/${encodeURIComponent(recordId)}/relink`, sendJson("POST", { docId }));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}

/** Delete a missing document's marks. */
export async function forgetMarks(recordId: string): Promise<void> {
  if (desktopApi) return desktopApi.marks.forget(recordId);
  const res = await fetch(`${apiBase}/api/marks/${encodeURIComponent(recordId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}
