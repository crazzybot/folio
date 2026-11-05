import type { DocumentContent, DocumentMeta, SearchResult } from "./types";

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
