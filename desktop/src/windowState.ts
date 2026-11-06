/**
 * windowState.ts — Remembers the main window's size, position and maximized
 * state across launches, in window-state.json (app state, like recent.json).
 * A saved position that no longer fits any display (a monitor was
 * unplugged) falls back to the default size, centred.
 */

import { app, screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 860 };
const SAVE_DELAY_MS = 500;

function statePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function isRectangle(value: unknown): value is Rectangle {
  if (value === null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/** Whether most of `bounds` is on some display (so the window can be reached). */
function isVisible(bounds: Rectangle): boolean {
  const area = screen.getDisplayMatching(bounds).workArea;
  const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return overlapWidth >= Math.min(200, bounds.width) && overlapHeight >= Math.min(100, bounds.height);
}

/** The saved state, or null for the default placement. */
export function loadWindowState(): WindowState | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (raw === null || typeof raw !== "object") return null;
    const { bounds, maximized } = raw as Record<string, unknown>;
    if (!isRectangle(bounds) || !isVisible(bounds)) return null;
    return { bounds, maximized: maximized === true };
  } catch {
    return null;
  }
}

/** Save `win`'s placement whenever it changes (debounced) and when it closes. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    // The un-maximized size, so leaving maximized mode restores it
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(state) + "\n");
    } catch {
      // Not remembered this time
    }
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  win.on("resize", saveSoon);
  win.on("move", saveSoon);
  win.on("maximize", saveSoon);
  win.on("unmaximize", saveSoon);
  win.on("close", save);
}
