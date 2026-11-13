/**
 * preload.ts — Exposes the document API to the renderer as `window.markdownApi`.
 *
 * Runs sandboxed, so it may only import `electron`. See frontend/src/api.ts
 * for the consumer.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

// View preferences, loaded once so the page can read them synchronously
// (see frontend/src/storage.ts and viewState.ts)
const viewState = new Map<string, string>(Object.entries(ipcRenderer.sendSync("view-state:load") as Record<string, string>));

contextBridge.exposeInMainWorld("markdownApi", {
  platform: process.platform,
  viewState: {
    get: (key: string): string | null => viewState.get(key) ?? null,
    set: (key: string, value: string): void => {
      viewState.set(key, value);
      ipcRenderer.send("view-state:set", key, value);
    },
  },
  // Fixed for the page's life: opening another workspace reloads the page
  workspacePath: ipcRenderer.sendSync("workspace:path") as string | null,
  // Workspace images are served by the main process (images.ts) from the app's origin
  workspaceFileBaseUrl: "app://bundle/@workspace/",
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getDocumentContent: (id: string) => ipcRenderer.invoke("documents:content", id),
  searchDocuments: (query: string) => ipcRenderer.invoke("documents:search", query),
  listAttachments: () => ipcRenderer.invoke("attachments:list"),
  getNavigationState: () => ipcRenderer.invoke("navigation:state"),
  /** Subscribe to back/forward availability; returns an unsubscribe function. */
  onNavigationStateChange: (callback: (state: NavigationState) => void) => {
    const listener = (_event: IpcRendererEvent, state: NavigationState) => callback(state);
    ipcRenderer.on("navigation:state", listener);
    return () => {
      ipcRenderer.removeListener("navigation:state", listener);
    };
  },
  getTheme: () => ipcRenderer.invoke("theme:get"),
  setTheme: (theme: string) => ipcRenderer.invoke("theme:set", theme),
  /** Subscribe to theme setting changes (menu, settings.json); returns an unsubscribe function. */
  onThemeChange: (callback: (theme: string) => void) => {
    const listener = (_event: IpcRendererEvent, theme: string) => callback(theme);
    ipcRenderer.on("theme:changed", listener);
    return () => {
      ipcRenderer.removeListener("theme:changed", listener);
    };
  },
  /** Settings the in-app panel shows and edits (see SettingsView in main.ts). */
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
    chooseWorkspace: () => ipcRenderer.invoke("settings:choose-workspace"),
    openFile: () => ipcRenderer.invoke("settings:open-file"),
    editCustomCss: () => ipcRenderer.invoke("settings:edit-custom-css"),
    /** Subscribe to settings changes from any source; returns an unsubscribe function. */
    onChange: (callback: (settings: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, settings: unknown) => callback(settings);
      ipcRenderer.on("settings:changed", listener);
      return () => {
        ipcRenderer.removeListener("settings:changed", listener);
      };
    },
    /** Subscribe to the Settings… menu item; returns an unsubscribe function. */
    onShow: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("settings:show", listener);
      return () => {
        ipcRenderer.removeListener("settings:show", listener);
      };
    },
  },
  /** Subscribe to Edit menu commands for the find bar and search; returns an unsubscribe function. */
  onFindCommand: (callback: (command: string) => void) => {
    const listener = (_event: IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("find:command", listener);
    return () => {
      ipcRenderer.removeListener("find:command", listener);
    };
  },
  /** The user's custom.css, or null. */
  getCustomCss: () => ipcRenderer.invoke("custom-css:get"),
  /** Subscribe to custom.css changes; returns an unsubscribe function. */
  onCustomCssChange: (callback: (css: string | null) => void) => {
    const listener = (_event: IpcRendererEvent, css: string | null) => callback(css);
    ipcRenderer.on("custom-css:changed", listener);
    return () => {
      ipcRenderer.removeListener("custom-css:changed", listener);
    };
  },
  /** The editor File → Open in Editor uses, by name; null for the default app. */
  getEditorName: () => ipcRenderer.invoke("editor:name"),
  /** Open the shown document in that editor. */
  openInEditor: () => ipcRenderer.invoke("editor:open"),
  /** Subscribe to changes of the editor setting; returns an unsubscribe function. */
  onEditorChange: (callback: (name: string | null) => void) => {
    const listener = (_event: IpcRendererEvent, name: string | null) => callback(name);
    ipcRenderer.on("editor:changed", listener);
    return () => {
      ipcRenderer.removeListener("editor:changed", listener);
    };
  },
  /** The file-system path of a dropped File ("" if it has none), for openPath. */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  /** Open a file a document links to, in its default app (only safe types; see files.ts). */
  openLinkedFile: (location: string) => ipcRenderer.invoke("workspace:open-file", location),
  /** Open a markdown file or a folder, as File → Open Folder… or Open With would. */
  openPath: (target: string) => ipcRenderer.invoke("workspace:open-path", target),
  /** Subscribe to markdown changes in the workspace; returns an unsubscribe function. */
  onWorkspaceChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("workspace:changed", listener);
    return () => {
      ipcRenderer.removeListener("workspace:changed", listener);
    };
  },
  /** Highlights, bookmarks and document notes (see marks.ts); the same shapes as the REST API. */
  marks: {
    list: () => ipcRenderer.invoke("marks:list"),
    addHighlight: (docId: string, body: unknown) => ipcRenderer.invoke("marks:highlight-add", docId, body),
    updateHighlight: (docId: string, highlightId: string, body: unknown) =>
      ipcRenderer.invoke("marks:highlight-update", docId, highlightId, body),
    deleteHighlight: (docId: string, highlightId: string) =>
      ipcRenderer.invoke("marks:highlight-delete", docId, highlightId),
    addBookmark: (docId: string, body: unknown) => ipcRenderer.invoke("marks:bookmark-add", docId, body),
    deleteBookmark: (docId: string, bookmarkId: string) => ipcRenderer.invoke("marks:bookmark-delete", docId, bookmarkId),
    setNote: (docId: string, body: unknown) => ipcRenderer.invoke("marks:note-set", docId, body),
    deleteNote: (docId: string) => ipcRenderer.invoke("marks:note-delete", docId),
    relink: (recordId: string, docId: string) => ipcRenderer.invoke("marks:relink", recordId, docId),
    forget: (recordId: string) => ipcRenderer.invoke("marks:forget", recordId),
    send: (docs: unknown, markSent: boolean) => ipcRenderer.invoke("marks:send", docs, markSent),
    unsend: (round: unknown) => ipcRenderer.invoke("marks:unsend", round),
    reply: (docId: string, highlightId: string | null, text: string) =>
      ipcRenderer.invoke("marks:reply", docId, highlightId, text),
    markSeen: (docId: string, highlightId: string | null) => ipcRenderer.invoke("marks:seen", docId, highlightId),
    /** Subscribe to marks changes from any window; returns an unsubscribe function. */
    onChange: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("marks:changed", listener);
      return () => {
        ipcRenderer.removeListener("marks:changed", listener);
      };
    },
  },
  /** The workspace's git repositories: branches and worktrees (see git.ts). */
  git: {
    state: () => ipcRenderer.invoke("git:state"),
    /** The branch menu of the repository at `location`, at the point (x, y). */
    showMenu: (location: string, x: number, y: number) => ipcRenderer.invoke("git:menu", location, x, y),
    /** Subscribe to changes (a checkout, a new worktree); returns an unsubscribe function. */
    onChange: (callback: (state: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on("git:changed", listener);
      return () => {
        ipcRenderer.removeListener("git:changed", listener);
      };
    },
  },
  /** A folder's context menu in the document list; resolves "focus" or null. */
  showFolderMenu: (location: string) => ipcRenderer.invoke("folder:context-menu", location),
});
