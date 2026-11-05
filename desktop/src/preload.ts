/**
 * preload.ts — Exposes the document API to the renderer as `window.markdownApi`.
 *
 * Runs sandboxed, so it may only import `electron`. The shape mirrors the
 * REST API in backend/app/main.py; see frontend/src/api.ts for the consumer.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("markdownApi", {
  platform: process.platform,
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getDocumentContent: (id: string) => ipcRenderer.invoke("documents:content", id),
});
