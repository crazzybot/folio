import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  findDocument,
  scanAttachments,
  scanWorkspace,
  splitFrontMatter,
  stableId,
  wikiLinkText,
} from "../src/scanner";
import { FIXTURES, SKIP, WORKSPACE } from "./fixtures";

// The backend's scanner must produce the same (backend/tests/test_scanner.py)
const expected = JSON.parse(readFileSync(path.join(FIXTURES, "expected-scan.json"), "utf8"));

describe("scanWorkspace", () => {
  it("matches the shared expected output", async () => {
    const docs = await scanWorkspace(WORKSPACE, SKIP);
    const comparable = docs.map(({ id, filename, location, title, headings }) => ({ id, filename, location, title, headings }));
    expect(comparable).toEqual(expected.documents);
  });

  it("caps the depth", async () => {
    const docs = await scanWorkspace(WORKSPACE, { ...SKIP, maxDepth: 1 });
    expect(docs.map((d) => d.location)).not.toContain("docs/guides/setup.markdown");
    expect(docs.map((d) => d.location)).toContain("docs/plain.md");
  });

  it("returns nothing for a missing workspace", async () => {
    expect(await scanWorkspace(path.join(WORKSPACE, "nope"))).toEqual([]);
  });
});

describe("scanAttachments", () => {
  it("matches the shared expected output", async () => {
    expect(await scanAttachments(WORKSPACE, SKIP)).toEqual(expected.attachments);
  });
});

describe("findDocument", () => {
  it("returns a document's content by id", async () => {
    const found = await findDocument(WORKSPACE, stableId("docs/plain.md"), SKIP);
    expect(found?.content).toBe("No headings here.\nSecond line.\n");
  });

  it("doesn't serve unknown ids, skipped folders or symlinks leaving the workspace", async () => {
    for (const location of ["nope.md", "node_modules/pkg/readme.md", "docs/outside-link.md"]) {
      expect(await findDocument(WORKSPACE, stableId(location), SKIP)).toBeNull();
    }
  });
});

describe("splitFrontMatter", () => {
  it("separates front matter and reads its title", () => {
    expect(splitFrontMatter('---\ntitle: "Quoted"\ntags: [x]\n---\nBody')).toEqual({ body: "Body", title: "Quoted" });
    expect(splitFrontMatter("---\ncreated: 1\n...\nBody")).toEqual({ body: "Body", title: null });
    expect(splitFrontMatter("---\n---\nBody")).toEqual({ body: "Body", title: null });
  });

  it("leaves text without front matter alone", () => {
    expect(splitFrontMatter("Text\n---\nmore")).toEqual({ body: "Text\n---\nmore", title: null });
    expect(splitFrontMatter("---\nnever closed")).toEqual({ body: "---\nnever closed", title: null });
  });
});

describe("wikiLinkText", () => {
  it.each([
    ["Note", "Note"],
    ["Note|alias", "alias"],
    ["Note#Heading", "Note > Heading"],
    ["#Heading", "Heading"],
    ["Note#^block", "Note"],
    ["folder/Note|  spaced  ", "spaced"],
  ])("[[%s]] reads %j", (inner, text) => {
    expect(wikiLinkText(inner)).toBe(text);
  });
});

describe("extractHeadings", () => {
  it("skips fenced code and front matter, and strips inline syntax", () => {
    const text = "---\n# not: a heading\n---\n# A *b* `c`\n```\n# no\n```\n## [Link](x) and [[N|alias]] ##\n####### seven\n#\n";
    expect(extractHeadings(text)).toEqual([
      { level: 1, text: "A b c" },
      { level: 2, text: "Link and alias" },
    ]);
  });

  it("reads one-line HTML headings", () => {
    const text = '<h1 align="center">A <em>b</em></h1>\n<H3>c</H3>\n<h2>unclosed\n<h7>no</h7>\n';
    expect(extractHeadings(text)).toEqual([
      { level: 1, text: "A b" },
      { level: 3, text: "c" },
    ]);
  });
});
