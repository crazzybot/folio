/**
 * agentPreload.ts — The agent panel's bridge (`window.agentApi`), for its
 * own view only (agentPanel.ts). The document view's preload has none of
 * these channels, so a page showing Markdown can't reach the terminal.
 *
 * Runs sandboxed, so it may only import `electron`. See
 * frontend/src/agent/main.ts for the consumer.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("agentApi", {
  ready: (cols: number, rows: number) => ipcRenderer.send("agent:ready", cols, rows),
  input: (data: string) => ipcRenderer.send("agent:input", data),
  resize: (cols: number, rows: number) => ipcRenderer.send("agent:resize", cols, rows),
  restart: () => ipcRenderer.send("agent:restart"),
  copyReviewLoopCommand: () => ipcRenderer.send("agent:copy-review-loop"),
  hide: () => ipcRenderer.send("agent:hide"),
  setHeight: (height: number) => ipcRenderer.send("agent:height", height),
  onData: (callback: (data: string) => void) => subscribe("agent:data", callback),
  onExit: (callback: (code: number) => void) => subscribe("agent:exit", callback),
  onInfo: (callback: (info: { title: string; folder: string; reviewLoop: string | null }) => void) => subscribe("agent:info", callback),
  onLoop: (callback: (state: "off" | "waiting" | "working") => void) => subscribe("agent:loop", callback),
  onFocus: (callback: () => void) => subscribe("agent:focus", callback),
});
