import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import remarkMathDollars from "./mathDollars";
import remarkObsidian from "./obsidian";
import type { ObsidianOptions } from "./obsidian";

interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
}

function nodes(tree: Node, type: string): Node[] {
  const found: Node[] = [];
  const walk = (n: Node) => {
    if (n.type === type) found.push(n);
    n.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

describe("remarkMathDollars", () => {
  const math = (src: string) => {
    const processor = unified().use(remarkParse).use(remarkMath).use(remarkMathDollars);
    return nodes(processor.runSync(processor.parse(src), { value: src }) as Node, "inlineMath").map((n) => n.value);
  };

  it.each([
    ["Inline $E=mc^2$ ok", ["E=mc^2"]],
    ["price $5 and $10.", []],
    ["between $5-$10", []],
    ["costs $5, or $6.50", []],
    ["$x$ and $y$", ["x", "y"]],
    ["$$a+b$$ inline", ["a+b"]],
  ])("%j", (src, expected) => {
    expect(math(src)).toEqual(expected);
  });
});

describe("remarkObsidian", () => {
  const options: ObsidianOptions = {
    documents: ["Home.md", "Note.md", "Projects/Note.md", "Projects/Plan.md", "My Notes/Space Name.md"],
    attachments: ["attachments/diagram.png", "Projects/diagram.png"],
    currentLocation: "Home.md",
  };
  const render = (src: string, opts: ObsidianOptions = options) => {
    const processor = unified().use(remarkParse).use(remarkObsidian, opts);
    return processor.runSync(processor.parse(src)) as Node;
  };
  const links = (src: string, opts?: ObsidianOptions) =>
    nodes(render(src, opts), "link").map((l) => [l.children?.[0]?.value, decodeURIComponent(l.url ?? "")]);

  it("resolves by name, preferring the current folder, then the shortest path", () => {
    expect(links("[[Note]] [[note]] [[Plan]]")).toEqual([
      ["Note", "/Note.md"],
      ["note", "/Note.md"],
      ["Plan", "/Projects/Plan.md"],
    ]);
    expect(links("[[Note]]", { ...options, currentLocation: "Projects/Plan.md" })).toEqual([["Note", "/Projects/Note.md"]]);
    expect(links("[[Projects/Note]]")).toEqual([["Projects/Note", "/Projects/Note.md"]]);
  });

  it("handles aliases, headings, block references and spaces", () => {
    expect(links("[[Note|the note]] [[Plan#Next Steps]] [[#Local heading]] [[Note#^abc]] [[Space Name]]")).toEqual([
      ["the note", "/Note.md"],
      ["Plan > Next Steps", "/Projects/Plan.md#next-steps"],
      ["Local heading", "#local-heading"],
      ["Note", "/Note.md"],
      ["Space Name", "/My Notes/Space Name.md"],
    ]);
  });

  it("points unresolved links at a missing location", () => {
    expect(links("[[Nowhere]]")).toEqual([["Nowhere", "/Nowhere"]]);
  });

  it("embeds images by name with an optional size, and links embedded notes", () => {
    const tree = render("![[diagram.png|300x200]] ![[nope.png|caption]] ![[Plan]]");
    expect(nodes(tree, "image").map((i) => [decodeURIComponent(i.url ?? ""), i.alt, i.data?.hProperties])).toEqual([
      ["/attachments/diagram.png", "diagram.png", { width: 300, height: 200 }],
      ["nope.png", "caption", {}],
    ]);
    expect(nodes(tree, "link").map((l) => l.url)).toEqual(["/Projects/Plan.md"]);
  });

  it("leaves code and existing links alone", () => {
    const tree = render("`[[code]]` and [a [[b]] link](x.md)");
    expect(nodes(tree, "inlineCode").map((n) => n.value)).toEqual(["[[code]]"]);
    expect(nodes(tree, "link").map((l) => l.url)).toEqual(["x.md"]);
  });
});
