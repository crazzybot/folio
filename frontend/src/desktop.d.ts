import type { DocumentContent, DocumentMeta, NavigationState, SearchResult } from "./types";

/** Document API exposed by the Electron preload script (desktop/src/preload.ts). */
interface MarkdownDesktopApi {
  /** Node's process.platform of the host, e.g. "darwin". */
  platform: string;
  /** View preferences, kept in view-state.json by the main process (see storage.ts). */
  viewState: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Base URL that workspace images are served from; append the encoded location. */
  workspaceFileBaseUrl: string;
  listDocuments(): Promise<DocumentMeta[]>;
  getDocumentContent(id: string): Promise<DocumentContent>;
  searchDocuments(query: string): Promise<SearchResult[]>;
  /** Workspace-relative paths of the image files. */
  listAttachments(): Promise<string[]>;
  getNavigationState(): Promise<NavigationState>;
  /** Subscribe to back/forward availability; returns an unsubscribe function. */
  onNavigationStateChange(callback: (state: NavigationState) => void): () => void;
  /** The theme setting ("system", "light" or "dark"), shared with View → Appearance. */
  getTheme(): Promise<string>;
  setTheme(theme: string): Promise<void>;
  /** Subscribe to theme setting changes (menu, settings.json); returns an unsubscribe function. */
  onThemeChange(callback: (theme: string) => void): () => void;
  /** The editor File → Open in Editor uses, by name; null for the default app. */
  getEditorName(): Promise<string | null>;
  /** Open the shown document in that editor. */
  openInEditor(): Promise<void>;
  /** Subscribe to changes of the editor setting; returns an unsubscribe function. */
  onEditorChange(callback: (name: string | null) => void): () => void;
  /** The file-system path of a dropped File ("" if it has none). */
  getPathForFile(file: File): string;
  /** Open a file a document links to (workspace location) in its default app. */
  openLinkedFile(location: string): Promise<void>;
  /** Open a markdown file or a folder (absolute path), as Open With would. */
  openPath(target: string): Promise<void>;
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
