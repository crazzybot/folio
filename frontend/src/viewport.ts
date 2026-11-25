/**
 * viewport.ts — The part of the window the page can be seen in.
 *
 * In the desktop app, the agent panel is a view of its own over the bottom
 * or the right of the page (desktop/src/agentPanel.ts): what the page draws
 * there is covered. While it shows at the bottom, --agent-panel-inset is its
 * distance from the window's bottom, status bar included; on the right,
 * --agent-panel-width is its width.
 */

function panelVar(name: string): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

/** The height, from the window's top, that isn't under the agent panel. */
export function visibleHeight(): number {
  return window.innerHeight - panelVar("--agent-panel-inset");
}

/** The width, from the window's left, that isn't under the agent panel. */
export function visibleWidth(): number {
  return window.innerWidth - panelVar("--agent-panel-width");
}

/** Calls `onChange` when the visible part changes: the window resized, or the agent panel moved. */
export function subscribeVisibleArea(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  const unsubscribe = window.markdownApi?.agentPanel.onLayoutChange(onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    unsubscribe?.();
  };
}
