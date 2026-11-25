import { useEffect, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { subscribeVisibleArea, visibleWidth } from "./viewport";

// In a narrow window (a phone), the side panels aren't shown beside the
// document: they slide in over it, one at a time, and close once used.

/** Too narrow for the outline beside the document: it becomes a drawer. */
export const OUTLINE_DRAWER_WIDTH = 960;
/** Too narrow for the document list beside the document: it becomes a drawer too. */
export const SIDEBAR_DRAWER_WIDTH = 768;

/**
 * Whether the page has at most `width` CSS pixels across, following window
 * resizes and rotation. As a max-width media query, but without the agent
 * panel when it's docked on the right (viewport.ts): the documents have
 * only what's left of the window.
 */
export function useNarrowerThan(width: number): boolean {
  return useSyncExternalStore(subscribeWidth, () => shownWidth() <= width);
}

// React reads the value on every render: keep it until the area changes
let cachedWidth: number | null = null;

function shownWidth(): number {
  cachedWidth ??= visibleWidth();
  return cachedWidth;
}

function subscribeWidth(onChange: () => void): () => void {
  return subscribeVisibleArea(() => {
    cachedWidth = null;
    onChange();
  });
}

/**
 * Moves focus into a drawer as it opens (the element needs tabIndex -1), and
 * back to what had it (its toolbar button) as it closes — unless focus has
 * since moved somewhere else outside the drawer.
 */
export function useDrawerFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const drawer = ref.current;
    if (!open || drawer === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body || drawer.contains(active)) opener?.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
