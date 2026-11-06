import { describe, expect, it } from "vitest";
import { stableId } from "../src/scanner";
import { searchContent, searchWorkspace } from "../src/search";
import { SKIP, WORKSPACE } from "./fixtures";

describe("searchContent", () => {
  it("counts every match and keeps the first three as snippets, numbered by occurrence", () => {
    const result = searchContent("foo\nbar FOO foo\nfoo", "foo");
    expect(result?.matchCount).toBe(4);
    expect(result?.matches.map((m) => [m.line, m.occurrence, m.text.slice(m.start, m.end)])).toEqual([
      [1, 0, "foo"],
      [2, 1, "FOO"],
      [2, 2, "foo"],
    ]);
  });

  it("shortens long lines around the match and drops indentation", () => {
    const line = "x".repeat(100) + " needle " + "y".repeat(120);
    const [long] = searchContent(line, "needle")?.matches ?? [];
    expect(long?.text.startsWith("…")).toBe(true);
    expect(long?.text.endsWith("…")).toBe(true);
    expect(long?.text.slice(long.start, long.end)).toBe("needle");
    const [indented] = searchContent("    an indented needle", "needle")?.matches ?? [];
    expect(indented?.text).toBe("an indented needle");
  });

  it("returns null without matches", () => {
    expect(searchContent("nothing", "needle")).toBeNull();
  });
});

describe("searchWorkspace", () => {
  it("finds documents by their text, in list order, skipping skipped folders", async () => {
    // "# not a heading" (in a code block), "Heading Ignored For Title", "No headings here."
    const results = await searchWorkspace(WORKSPACE, "heading", SKIP);
    expect(results.map((r) => [r.id, r.matchCount])).toEqual([
      [stableId("README.md"), 1],
      [stableId("docs/front-matter.md"), 1],
      [stableId("docs/plain.md"), 1],
    ]);
    expect(await searchWorkspace(WORKSPACE, "Vendored", SKIP)).toEqual([]);
  });

  it("ignores queries under two characters", async () => {
    expect(await searchWorkspace(WORKSPACE, " a ", SKIP)).toEqual([]);
  });
});
