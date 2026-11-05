import type { DocumentContent, DocumentMeta } from "./types";

/** Document API exposed by the Electron preload script (desktop/src/preload.ts). */
interface MarkdownDesktopApi {
  /** Node's process.platform of the host, e.g. "darwin". */
  platform: string;
  listDocuments(): Promise<DocumentMeta[]>;
  getDocumentContent(id: string): Promise<DocumentContent>;
}

declare global {
  interface Window {
    /** Present only when running inside the desktop app. */
    markdownApi?: MarkdownDesktopApi;
  }
}

export {};
