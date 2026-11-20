/**
 * viewport.ts — The part of the window the page can be seen in.
 *
 * In the desktop app, the agent panel is a view of its own over the bottom
 * of the page (desktop/src/agentPanel.ts): what the page draws there is
 * covered. While it shows, --agent-panel-inset is its distance from the
 * window's bottom, status bar included.
 */

/** The height, from the window's top, that isn't under the agent panel. */
export function visibleHeight(): number {
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--agent-panel-inset"));
  return window.innerHeight - (Number.isFinite(inset) ? inset : 0);
}
