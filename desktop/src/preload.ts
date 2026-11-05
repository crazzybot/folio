/**
 * preload.ts — Exposes the document API to the renderer as `window.markdownApi`.
 *
 * Runs sandboxed, so it may only import `electron`. The shape mirrors the
 * REST API in backend/app/main.py; see frontend/src/api.ts for the consumer.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

contextBridge.exposeInMainWorld("markdownApi", {
  platform: process.platform,
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getDocumentContent: (id: string) => ipcRenderer.invoke("documents:content", id),
  getNavigationState: () => ipcRenderer.invoke("navigation:state"),
  /** Subscribe to back/forward availability; returns an unsubscribe function. */
  onNavigationStateChange: (callback: (state: NavigationState) => void) => {
    const listener = (_event: IpcRendererEvent, state: NavigationState) => callback(state);
    ipcRenderer.on("navigation:state", listener);
    return () => {
      ipcRenderer.removeListener("navigation:state", listener);
    };
  },
  /** Subscribe to markdown changes in the workspace; returns an unsubscribe function. */
  onWorkspaceChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("workspace:changed", listener);
    return () => {
      ipcRenderer.removeListener("workspace:changed", listener);
    };
  },
});
