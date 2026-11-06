import { describe, expect, it } from "vitest";
import { buildDocumentTree, foldersContaining } from "./documentTree";
import type { TreeNode } from "./documentTree";
import type { DocumentMeta } from "./types";

const doc = (location: string): DocumentMeta => ({
  id: location,
  filename: location.split("/").pop() ?? location,
  location,
  title: location,
  created: "",
  headings: [],
});

/** The tree as indented lines: "▾ label/" for folders, "label  (hint)" for documents. */
function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.kind === "folder"
      ? [`${"  ".repeat(depth)}▾ ${n.label}/`, ...outline(n.children, depth + 1)]
      : [`${"  ".repeat(depth)}${n.doc.location.split("/").pop()}${n.hint ? `  (${n.hint})` : ""}`],
  );
}

describe("buildDocumentTree", () => {
  it("merges folder chains and lifts single-document folders (option B)", () => {
    const tree = buildDocumentTree(
      [
        "README.md",
        "CHANGELOG.md",
        "docs/index.md",
        "docs/guides/getting-started.md",
        "docs/guides/install.md",
        "docs/api/v2/endpoints/users.md",
        "docs/api/v2/endpoints/orders.md",
        "docs/adr/0001-record.md",
        "packages/core/src/README.md",
        "packages/ui/README.md",
        "packages/ui/docs/theming.md",
        "notes/2026/11/standup.md",
      ].map(doc),
    );
    expect(outline(tree)).toEqual([
      "▾ docs/",
      "  ▾ api / v2 / endpoints/",
      "    orders.md",
      "    users.md",
      "  ▾ guides/",
      "    getting-started.md",
      "    install.md",
      "  0001-record.md  (adr)",
      "  index.md",
      "▾ packages/",
      "  ▾ ui/",
      "    theming.md  (docs)",
      "    README.md",
      "  README.md  (core / src)",
      "CHANGELOG.md",
      "standup.md  (notes / 2026 / 11)",
      "README.md",
    ]);
  });

  it("shows the contents of a single top folder at the top level", () => {
    expect(outline(buildDocumentTree(["docs/a.md", "docs/b.md", "docs/sub/c.md", "docs/sub/d.md"].map(doc)))).toEqual([
      "▾ sub/",
      "  c.md",
      "  d.md",
      "a.md",
      "b.md",
    ]);
  });

  it("sorts folders naturally and keeps keys stable", () => {
    const tree = buildDocumentTree(["v10/a.md", "v10/b.md", "v2/a.md", "v2/b.md", "x.md"].map(doc));
    expect(tree.map((n) => (n.kind === "folder" ? n.key : n.doc.location))).toEqual(["v2", "v10", "x.md"]);
  });

  it("is empty for no documents", () => {
    expect(buildDocumentTree([])).toEqual([]);
  });
});

describe("foldersContaining", () => {
  const tree = buildDocumentTree(["a/b/c/x.md", "a/b/c/y.md", "a/z.md", "a/w.md", "top.md"].map(doc));

  it("lists the keys of the folders to expand for a document", () => {
    // "a" holds z.md and w.md too, so it stays a folder; "b / c" is merged
    expect(foldersContaining(tree, "a/b/c/x.md")).toEqual(["a", "a/b/c"]);
    expect(foldersContaining(tree, "a/z.md")).toEqual(["a"]);
    expect(foldersContaining(tree, "top.md")).toEqual([]);
  });
});
