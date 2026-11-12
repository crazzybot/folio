import { describe, expect, it } from "vitest";
import { buildMarkRows } from "./marksView";
import type { MarkRowsInput } from "./marksView";
import type { StateFilter } from "./sending";
import type { Bookmark, DocumentMeta, Highlight } from "./types";

const doc = (location: string, headings: { level: number; text: string }[] = []): DocumentMeta => ({
  id: location,
  filename: location.split("/").pop() ?? location,
  location,
  title: location.replace(/\.md$/, ""),
  created: "",
  headings,
});

const highlight = (id: string, exact: string, start: number, note: string | null = null): Highlight => ({
  id,
  color: "yellow",
  note,
  quote: { exact, prefix: "", suffix: "" },
  position: { start, end: start + exact.length },
  created: "",
  updated: "",
});

const bookmark = (id: string, heading: Bookmark["heading"]): Bookmark => ({ id, heading, created: "" });

const guide = doc("guide.md", [
  { level: 1, text: "Guide" },
  { level: 2, text: "Install" },
  { level: 2, text: "Usage" },
]);
const notes = doc("notes.md");

const byDoc = new Map([
  [
    "guide.md",
    {
      bookmarks: [
        bookmark("b-usage", { text: "Usage", level: 2, occurrence: 0 }),
        bookmark("b-gone", { text: "Removed", level: 2, occurrence: 0 }),
        bookmark("b-doc", null),
      ],
      highlights: [highlight("h2", "second passage", 50, "Check this"), highlight("h1", "first passage", 10)],
    },
  ],
  ["notes.md", { bookmarks: [], highlights: [highlight("h3", "an idea", 5)] }],
]);

const base: MarkRowsInput = {
  documents: [guide, notes],
  byDoc,
  query: "",
  collapsed: new Set(),
  located: null,
};

const keys = (input: Partial<MarkRowsInput>) => buildMarkRows({ ...base, ...input }).map((r) => r.key);

describe("buildMarkRows", () => {
  it("groups marks by document: heading bookmarks in document order, then highlights in text order", () => {
    expect(keys({})).toEqual([
      "d:guide.md",
      "b:guide.md:b-usage",
      "b:guide.md:b-gone",
      "h:guide.md:h1",
      "h:guide.md:h2",
      "d:notes.md",
      "h:notes.md:h3",
    ]);
  });

  it("shows the document's own bookmark on its row, and counts the rest", () => {
    const [row] = buildMarkRows(base);
    expect(row?.kind === "document" && [row.bookmark?.id, row.count]).toEqual(["b-doc", 4]);
  });

  it("lists a document whose only mark is its bookmark, with nothing to unfold", () => {
    const only = new Map([["notes.md", { bookmarks: [bookmark("n", null)], highlights: [] }]]);
    const rows = buildMarkRows({ ...base, byDoc: only });
    expect(rows.map((r) => r.kind === "document" && [r.key, r.count, r.expanded])).toEqual([["d:notes.md", 0, false]]);
  });

  it("marks a heading bookmark whose heading is gone", () => {
    const rows = buildMarkRows(base).filter((r) => r.kind === "bookmark");
    expect(rows.map((r) => r.kind === "bookmark" && r.missing)).toEqual([false, true]);
  });

  it("folds a collapsed document, unless filtering", () => {
    expect(keys({ collapsed: new Set(["guide.md"]) })).toEqual(["d:guide.md", "d:notes.md", "h:notes.md:h3"]);
    expect(keys({ collapsed: new Set(["guide.md"]), query: "passage" })).toContain("h:guide.md:h1");
  });

  it("filters by highlighted text, note, heading and document title", () => {
    expect(keys({ query: "check" })).toEqual(["d:guide.md", "h:guide.md:h2"]);
    expect(keys({ query: "usage" })).toEqual(["d:guide.md", "b:guide.md:b-usage"]);
    expect(keys({ query: "notes" })).toEqual(["d:notes.md", "h:notes.md:h3"]);
  });

  it("shows only bookmarks, or only highlights and notes", () => {
    expect(keys({ kinds: new Set(["highlights"]) })).toEqual([
      "d:guide.md",
      "h:guide.md:h1",
      "h:guide.md:h2",
      "d:notes.md",
      "h:notes.md:h3",
    ]);
    expect(keys({ kinds: new Set(["bookmarks"]) })).toEqual(["d:guide.md", "b:guide.md:b-usage", "b:guide.md:b-gone"]);
  });

  it("marks the open document's highlights that aren't in its text", () => {
    const rows = buildMarkRows({ ...base, located: { docId: "guide.md", ids: new Set(["h1"]) } });
    const unplaced = rows.flatMap((r) => (r.kind === "highlight" && r.unplaced ? [r.highlight.id] : []));
    expect(unplaced).toEqual(["h2"]);
  });

  it("leaves out documents outside the list (a focused folder)", () => {
    expect(keys({ documents: [notes] })).toEqual(["d:notes.md", "h:notes.md:h3"]);
  });
});

describe("buildMarkRows with a note on the document", () => {
  const adr = { ...doc("adr.md"), meta: { status: "proposed", statusDetail: null, date: null, people: [], tags: [], statusLine: null } };
  const note = { text: "Fine once the rotation question is answered.", requestedStatus: "accepted", created: "", updated: "" };
  const input: MarkRowsInput = {
    ...base,
    documents: [adr, notes],
    byDoc: new Map([
      ["adr.md", { bookmarks: [], highlights: [highlight("h9", "a passage", 3)], note }],
      ["notes.md", { bookmarks: [], highlights: [highlight("h3", "an idea", 5)] }],
    ]),
  };
  const keys = (rows: ReturnType<typeof buildMarkRows>) => rows.map((r) => r.key);

  it("lists the note first under its document, counted with its marks", () => {
    const rows = buildMarkRows(input);
    expect(keys(rows)).toEqual(["d:adr.md", "n:adr.md", "h:adr.md:h9", "d:notes.md", "h:notes.md:h3"]);
    expect(rows[0]).toMatchObject({ kind: "document", count: 2 });
    expect(rows[1]).toMatchObject({ kind: "note", done: false });
  });

  it("lists a document that has only a note", () => {
    const only = new Map([["adr.md", { bookmarks: [], highlights: [], note }]]);
    expect(keys(buildMarkRows({ ...input, byDoc: only }))).toEqual(["d:adr.md", "n:adr.md"]);
  });

  it("keeps it with highlights and notes, and finds it by its comment or status", () => {
    expect(keys(buildMarkRows({ ...input, kinds: new Set(["highlights"]) }))).toEqual(["d:adr.md", "n:adr.md", "h:adr.md:h9", "d:notes.md", "h:notes.md:h3"]);
    expect(keys(buildMarkRows({ ...input, query: "rotation" }))).toEqual(["d:adr.md", "n:adr.md"]);
    expect(keys(buildMarkRows({ ...input, query: "accepted" }))).toEqual(["d:adr.md", "n:adr.md"]);
  });

  it("knows when the document already has the requested status", () => {
    const accepted = { ...adr, meta: { ...adr.meta, status: "accepted" } };
    const rows = buildMarkRows({ ...input, documents: [accepted] });
    expect(rows[1]).toMatchObject({ kind: "note", done: true });
  });
});

describe("buildMarkRows by state", () => {
  it("shows notes by state, private marks among them, and sums up a document's feedback", () => {
    const states = (...shown: StateFilter[]) =>
      buildMarkRows({ ...base, states: new Set(shown) }).map((r) => r.key);
    // h2 has a note (feedback, open); h1 and h3 are bare highlights (private)
    expect(states("open")).toEqual(["d:guide.md", "b:guide.md:b-usage", "b:guide.md:b-gone", "h:guide.md:h2"]);
    expect(states("private")).toContain("h:notes.md:h3");
    expect(states("private")).not.toContain("h:guide.md:h2");
    const [row] = buildMarkRows(base);
    expect(row).toMatchObject({ kind: "document", summary: "1 unsent" });
  });
});
