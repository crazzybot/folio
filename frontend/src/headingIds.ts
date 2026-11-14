/**
 * headingIds.ts — rehype plugin that gives each heading its anchor id: the
 * GFM slug of its text (see slug.ts). Like GitHub, a repeated slug gets a
 * numbered suffix ("added", "added-1", "added-2"), so headings with the same
 * text under different sections each have their own anchor, and the outline
 * can tell them apart.
 *
 * Headings that already have an id (raw HTML) keep it.
 */
import { slugify } from "./slug";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-6]$/;

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(textOf).join("") ?? "";
}

export default function rehypeHeadingIds() {
  return (tree: HastNode): void => {
    const used = new Set<string>();
    const walk = (node: HastNode) => {
      if (node.type === "element" && HEADING.test(node.tagName ?? "")) {
        const properties = (node.properties ??= {});
        const slug = slugify(textOf(node));
        if (properties["id"] === undefined && slug !== "") {
          // Skip suffixes another heading already took ("Added 1" → "added-1")
          let id = slug;
          for (let n = 1; used.has(id); n++) id = `${slug}-${n}`;
          used.add(id);
          properties["id"] = id;
        }
        return;
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
