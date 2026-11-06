/**
 * storage.ts — Where view preferences are remembered (sidebar width, folder
 * tree, reading width, font size…): string keys and values, read
 * synchronously so the first render already uses them.
 *
 * Desktop app: kept by the main process in view-state.json (see
 * desktop/src/viewState.ts) — Chromium doesn't keep localStorage of the
 * app's own app:// origin across restarts. Browser: localStorage.
 */

const desktop = window.markdownApi?.viewState;

export function getItem(key: string): string | null {
  if (desktop) return desktop.get(key);
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage unavailable: callers fall back to defaults
  }
}

export function setItem(key: string, value: string): void {
  if (desktop) {
    desktop.set(key, value);
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered, but still applied
  }
}
