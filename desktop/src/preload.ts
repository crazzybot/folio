/**
 * preload.ts — Exposes the document API to the renderer as `window.markdownApi`.
 *
 * Runs sandboxed, so it may only import `electron`. The shape mirrors the
 * REST API in backend/app/main.py; see frontend/src/api.ts for the consumer.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

contextBridge.exposeInMainWorld("markdownApi", {
  platform: process.platform,
  // Workspace images are served by the main process (images.ts) from the app's origin
  workspaceFileBaseUrl: "app://bundle/@workspace/",
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getDocumentContent: (id: string) => ipcRenderer.invoke("documents:content", id),
  searchDocuments: (query: string) => ipcRenderer.invoke("documents:search", query),
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
});
