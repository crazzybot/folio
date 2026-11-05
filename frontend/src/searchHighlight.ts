/**
 * searchHighlight.ts — Highlights search matches in the rendered document
 * with the CSS Custom Highlight API (styled by ::highlight() in index.css).
 * Ranges are painted over the DOM React rendered without changing it, so
 * re-renders and live reload aren't disturbed.
 */

/**
 * Two independent layers: "search" for the sidebar's text search, "find"
 * for the find bar. Each paints `folio-<layer>` and `folio-<layer>-current`.
 */
export type HighlightLayer = "search" | "find";

const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/**
 * Ranges of every case-insensitive occurrence of `query` in the text under
 * `root`, in document order. Matches may span elements ("foo **bar**").
 */
export function findMatches(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];

  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += (node as Text).data;
  }
  const lower = text.toLowerCase();
  // Some characters change length when lowercased; offsets would drift
  if (lower.length !== text.length) return [];

  /** The text node and offset for a position in the joined text. */
  function locate(position: number, isEnd: boolean): [Text, number] {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      // An end position on a boundary belongs to the earlier node
      if ((starts[mid] ?? 0) < position || (!isEnd && starts[mid] === position)) lo = mid;
      else hi = mid - 1;
    }
    const node = nodes[lo] as Text;
    return [node, position - (starts[lo] ?? 0)];
  }

  const ranges: Range[] = [];
  let at = lower.indexOf(needle);
  while (at !== -1) {
    const range = document.createRange();
    range.setStart(...locate(at, false));
    range.setEnd(...locate(at + needle.length, true));
    ranges.push(range);
    at = lower.indexOf(needle, at + needle.length);
  }
  return ranges;
}

/** Paint `ranges` as matches and `current` (if any) as the focused one. */
export function showMatches(layer: HighlightLayer, ranges: Range[], current: Range | null): void {
  if (!supported) return;
  CSS.highlights.set(`folio-${layer}`, new Highlight(...ranges));
  if (current === null) CSS.highlights.delete(`folio-${layer}-current`);
  else CSS.highlights.set(`folio-${layer}-current`, new Highlight(current));
}

export function clearMatches(layer: HighlightLayer): void {
  if (!supported) return;
  CSS.highlights.delete(`folio-${layer}`);
  CSS.highlights.delete(`folio-${layer}-current`);
}
