import type { DocumentContent, DocumentMeta, NavigationState } from "./types";

/** Document API exposed by the Electron preload script (desktop/src/preload.ts). */
interface MarkdownDesktopApi {
  /** Node's process.platform of the host, e.g. "darwin". */
  platform: string;
  /** Base URL that workspace images are served from; append the encoded location. */
  workspaceFileBaseUrl: string;
  listDocuments(): Promise<DocumentMeta[]>;
  getDocumentContent(id: string): Promise<DocumentContent>;
  getNavigationState(): Promise<NavigationState>;
  /** Subscribe to back/forward availability; returns an unsubscribe function. */
  onNavigationStateChange(callback: (state: NavigationState) => void): () => void;
  /** The theme setting ("system", "light" or "dark"), shared with View → Appearance. */
  getTheme(): Promise<string>;
  setTheme(theme: string): Promise<void>;
  /** Subscribe to theme setting changes (menu, settings.json); returns an unsubscribe function. */
  onThemeChange(callback: (theme: string) => void): () => void;
  /** Subscribe to markdown changes in the workspace; returns an unsubscribe function. */
  onWorkspaceChange(callback: () => void): () => void;
}

declare global {
  interface Window {
    /** Present only when running inside the desktop app. */
    markdownApi?: MarkdownDesktopApi;
  }
}

export {};
