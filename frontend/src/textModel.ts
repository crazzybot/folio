/**
 * textModel.ts — The rendered document as one string, for highlights
 * (anchoring.ts): offsets into it map back to DOM ranges and selections map
 * to offsets.
 *
 * Text that isn't the document's own is left out, so anchors don't shift
 * when it changes: buttons (code blocks' Copy), Mermaid diagrams (drawn
 * after the page), KaTeX's generated markup, and anything marked
 * `data-marks-skip`.
 */

const SKIP = "button, svg, .katex, [data-marks-skip], script, style, textarea, input";

export interface TextModel {
  text: string;
  /** A DOM range for `text.slice(start, end)`. */
  range(start: number, end: number): Range;
  /** The text offset of a DOM boundary point (e.g. a selection's start or end). */
  offsetOf(node: Node, offset: number): number;
}

export function buildTextModel(root: HTMLElement): TextModel {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeType === Node.TEXT_NODE
        ? NodeFilter.FILTER_ACCEPT
        : (node as Element).matches(SKIP)
          ? NodeFilter.FILTER_REJECT // and everything inside it
          : NodeFilter.FILTER_SKIP,
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += (node as Text).data;
  }
  const indexOf = new Map(nodes.map((node, i) => [node, i]));

  /** The text node and offset for a position; an end on a boundary belongs to the earlier node. */
  function locate(position: number, isEnd: boolean): [Text, number] {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) < position || (!isEnd && starts[mid] === position)) lo = mid;
      else hi = mid - 1;
    }
    const node = nodes[lo] as Text;
    return [node, Math.min(position - (starts[lo] ?? 0), node.data.length)];
  }

  return {
    text,
    range(start, end) {
      const range = document.createRange();
      if (nodes.length === 0) return range;
      range.setStart(...locate(start, false));
      range.setEnd(...locate(end, true));
      return range;
    },
    offsetOf(node, offset) {
      const i = node.nodeType === Node.TEXT_NODE ? indexOf.get(node as Text) : undefined;
      if (i !== undefined) return (starts[i] ?? 0) + offset;
      // An element boundary, or inside left-out text: the first counted text after it
      const after = document.createRange();
      after.setStart(node, offset);
      after.setEnd(root, root.childNodes.length);
      const next = nodes.findIndex((n) => after.intersectsNode(n));
      return next === -1 ? text.length : (starts[next] ?? 0);
    },
  };
}
