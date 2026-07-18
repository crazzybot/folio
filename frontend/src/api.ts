import type { DocumentContent, DocumentMeta } from "./types";

const apiBase: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDocuments(): Promise<DocumentMeta[]> {
  const res = await fetch(`${apiBase}/api/documents`);
  return handleResponse<DocumentMeta[]>(res);
}

export async function fetchDocumentContent(id: string): Promise<DocumentContent> {
  const res = await fetch(`${apiBase}/api/documents/${encodeURIComponent(id)}/content`);
  return handleResponse<DocumentContent>(res);
}
