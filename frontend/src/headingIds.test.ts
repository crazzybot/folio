import { describe, expect, it } from "vitest";
import rehypeHeadingIds from "./headingIds";

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const text = (value: string): Node => ({ type: "text", value });
const heading = (level: number, ...children: Node[]): Node => ({
  type: "element",
  tagName: `h${level}`,
  properties: {},
  children,
});

function ids(...headings: Node[]): unknown[] {
  const tree: Node = { type: "root", children: headings };
  rehypeHeadingIds()(tree);
  return headings.map((h) => h.properties?.["id"]);
}

describe("rehypeHeadingIds", () => {
  it("gives each heading the GFM slug of its text, inline markup included", () => {
    const emphasis: Node = { type: "element", tagName: "em", properties: {}, children: [text("Started")] };
    expect(ids(heading(1, text("Getting "), emphasis), heading(2, text("3. Core concepts")))).toEqual([
      "getting-started",
      "3-core-concepts",
    ]);
  });

  it("numbers repeated headings as GitHub does", () => {
    expect(ids(heading(3, text("Added")), heading(3, text("Fixed")), heading(3, text("Added")), heading(3, text("Added")))).toEqual(
      ["added", "fixed", "added-1", "added-2"],
    );
  });

  it("skips a suffix another heading already has", () => {
    expect(ids(heading(2, text("Added 1")), heading(2, text("Added")), heading(2, text("Added")))).toEqual([
      "added-1",
      "added",
      "added-2",
    ]);
  });

  it("keeps an id the heading already has, and leaves empty headings without one", () => {
    const raw = heading(2, text("Added"));
    raw.properties = { id: "user-content-mine" };
    expect(ids(raw, heading(2), heading(2, text("Added")))).toEqual(["user-content-mine", undefined, "added"]);
  });
});
