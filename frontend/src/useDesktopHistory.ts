import { useEffect, useState } from "react";
import type { NavigationState } from "./types";

const api = window.markdownApi;

// Mouse buttons 4 and 5 (MouseEvent.button 3 and 4)
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/**
 * Back/forward availability in the desktop app, kept in sync by the main
 * process (which also owns the Go menu). Null in the browser, whose own
 * toolbar already provides back/forward.
 *
 * Also maps the mouse's back/forward buttons to history navigation, which
 * Electron doesn't do by itself.
 */
export default function useDesktopHistory(): NavigationState | null {
  const [state, setState] = useState<NavigationState | null>(
    api ? { canGoBack: false, canGoForward: false } : null,
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.getNavigationState().then((initial) => {
      if (!cancelled) setState(initial);
    });
    const unsubscribe = api.onNavigationStateChange(setState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    function onMouseUp(e: MouseEvent) {
      if (e.button === MOUSE_BACK) {
        e.preventDefault();
        window.history.back();
      } else if (e.button === MOUSE_FORWARD) {
        e.preventDefault();
        window.history.forward();
      }
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  return state;
}
