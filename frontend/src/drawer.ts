import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RefObject } from "react";

// In a narrow window (a phone), the side panels aren't shown beside the
// document: they slide in over it, one at a time, and close once used.

/** Too narrow for the outline beside the document: it becomes a drawer. */
export const OUTLINE_DRAWER_QUERY = "(max-width: 960px)";
/** Too narrow for the document list beside the document: it becomes a drawer too. */
export const SIDEBAR_DRAWER_QUERY = "(max-width: 768px)";

/** Whether the media query matches, following window resizes and rotation. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
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
