/**
 * Scroll positions of the document viewer, stored in the history entries
 * themselves (`history.state`) so Back/Forward can return to where the
 * reader was. The router keeps its own fields (key, idx, usr) in the same
 * object, so they're copied over rather than replaced.
 */

const SCROLL_TOP_KEY = "viewerScrollTop";

function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state !== null && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

/** Remember `scrollTop` on the current history entry, before navigating away from it. */
export function saveScrollPosition(scrollTop: number): void {
  window.history.replaceState({ ...currentState(), [SCROLL_TOP_KEY]: scrollTop }, "");
}

/** The scroll position saved on the current history entry, if any. */
export function savedScrollPosition(): number | null {
  const value = currentState()[SCROLL_TOP_KEY];
  return typeof value === "number" ? value : null;
}
