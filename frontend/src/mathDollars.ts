/**
 * mathDollars.ts — remark plugin that applies GitHub's rules for $…$ math,
 * which remark-math doesn't: the math must not start or end with
 * whitespace, and the closing $ must not be followed by a digit. Anything
 * else is put back as the text it was, so prices like "$5 and $10" or
 * "$5-$10" stay prices.
 *
 * Only single-dollar math is checked; $$…$$ and ```math are always math.
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function isPrice(node: MdNode, source: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const raw = source.slice(start, end);
  if (raw.startsWith("$$")) return false;
  const value = raw.slice(1, -1);
  return /^\s|\s$/.test(value) || /^\d/.test(source.charAt(end));
}

function fix(parent: MdNode, source: string): void {
  const children = parent.children;
  if (children === undefined) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child.type === "inlineMath" && isPrice(child, source)) {
      const { start, end } = child.position as { start: { offset: number }; end: { offset: number } };
      children[i] = { type: "text", value: source.slice(start.offset, end.offset) };
    } else {
      fix(child, source);
    }
  }
}

export default function remarkMathDollars() {
  return (tree: MdNode, file: { value: unknown }) => {
    fix(tree, String(file.value));
  };
}
