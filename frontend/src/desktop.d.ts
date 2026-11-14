import type {
  Bookmark,
  DocumentContent,
  DocumentMeta,
  DocumentNote,
  DocumentRead,
  GitState,
  Highlight,
  MarksListing,
  NavigationState,
  SearchResult,
  SendDocument,
  SentRound,
} from "./types";

/** The desktop settings the in-app panel shows (desktop/src/main.ts settingsView). */
export interface DesktopSettings {
  workspace: string | null;
  skipDirs: string[];
  maxDepth: number | null;
  editor: string | null;
  /** Whether review notes start with instructions for the agent. */
  reviewIntroOn: boolean;
  /** Their wording; "" for the default. */
  reviewIntro: string;
  defaultSkipDirs: string[];
  /** The editor used when `editor` is null, if one is installed (macOS). */
  detectedEditor: string | null;
}

/** Document API exposed by the Electron preload script (desktop/src/preload.ts). */
interface MarkdownDesktopApi {
  /** Node's process.platform of the host, e.g. "darwin". */
  platform: string;
  /** View preferences, kept in view-state.json by the main process (see storage.ts). */
  viewState: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** The workspace folder's absolute path when the page loaded (a new workspace reloads it). */
  workspacePath: string | null;
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
  /** Settings for the in-app panel; changes are validated like settings.json. */
  settings: {
    get(): Promise<DesktopSettings>;
    set(
      patch: Partial<Pick<DesktopSettings, "skipDirs" | "maxDepth" | "editor" | "reviewIntroOn" | "reviewIntro">>,
    ): Promise<DesktopSettings>;
    chooseWorkspace(): Promise<void>;
    openFile(): Promise<void>;
    editCustomCss(): Promise<void>;
    onChange(callback: (settings: DesktopSettings) => void): () => void;
    onShow(callback: () => void): () => void;
  };
  /**
   * Subscribe to Edit menu commands ("open", "next", "previous", "search-text",
   * "highlight", "bookmark"); returns an unsubscribe function.
   */
  onFindCommand(callback: (command: string) => void): () => void;
  /** The user's custom.css (View → Edit Custom CSS…), or null. */
  getCustomCss(): Promise<string | null>;
  /** Subscribe to custom.css changes; returns an unsubscribe function. */
  onCustomCssChange(callback: (css: string | null) => void): () => void;
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
  /** Highlights and bookmarks, kept by the main process in ~/.folio/marks (desktop/src/marks.ts). */
  marks: {
    list(): Promise<MarksListing>;
    addHighlight(docId: string, body: unknown): Promise<Highlight>;
    updateHighlight(docId: string, highlightId: string, body: unknown): Promise<Highlight>;
    deleteHighlight(docId: string, highlightId: string): Promise<void>;
    addBookmark(docId: string, body: unknown): Promise<Bookmark>;
    deleteBookmark(docId: string, bookmarkId: string): Promise<void>;
    setNote(docId: string, body: unknown): Promise<DocumentNote | null>;
    deleteNote(docId: string): Promise<void>;
    relink(recordId: string, docId: string): Promise<void>;
    forget(recordId: string): Promise<void>;
    /** Record a round of sent notes; with `markSent`, open notes become sent. */
    send(docs: readonly SendDocument[], markSent: boolean): Promise<SentRound>;
    /** Undo a round `send` recorded. */
    unsend(round: SentRound): Promise<void>;
    /** The user's reply to a note (highlightId null: the document's note). */
    reply(docId: string, highlightId: string | null, text: string): Promise<Highlight | DocumentNote>;
    /** Record that the user saw a note's thread. */
    markSeen(docId: string, highlightId: string | null): Promise<void>;
    /** Subscribe to marks changes from any window; returns an unsubscribe function. */
    onChange(callback: () => void): () => void;
  };
  /** Which version of each document was last read (packages/core/src/reads.ts). */
  reads: {
    list(): Promise<DocumentRead[]>;
    mark(docId: string, sha1: string): Promise<void>;
    unmark(docId: string): Promise<void>;
    snapshot(docId: string): Promise<string | null>;
    markFolder(folder: string): Promise<void>;
    /** Subscribe to changes from any window; returns an unsubscribe function. */
    onChange(callback: () => void): () => void;
  };
  /** The workspace's git repositories (desktop/src/git.ts); null without git or a repository. */
  git: {
    state(): Promise<GitState | null>;
    /** The native branch menu of the repository at `location`, at the point (x, y) in the window. */
    showMenu(location: string, x: number, y: number): Promise<void>;
    onChange(callback: (state: GitState | null) => void): () => void;
  };
  /**
   * The context menu of a folder in the document list (workspace location).
   * Resolves "focus" for Focus on Folder, "mark-read" for Mark All as Read
   * (offered when `hasUnread`), else null; Open Folder as Workspace and
   * Reveal in Finder are handled by the main process.
   */
  showFolderMenu(location: string, hasUnread: boolean): Promise<"focus" | "mark-read" | null>;
  /**
   * The context menu of a document in the list: Mark as Read when `unread`,
   * else Mark as Unread; Open in Editor and Reveal in Finder are handled by
   * the main process.
   */
  showDocumentMenu(docId: string, unread: boolean): Promise<"read" | "unread" | null>;
}

declare global {
  interface Window {
    /** Present only when running inside the desktop app. */
    markdownApi?: MarkdownDesktopApi;
  }
}

export {};
