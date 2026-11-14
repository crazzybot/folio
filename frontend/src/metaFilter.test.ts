import { describe, expect, it } from "vitest";
import { filterByMeta, filterOptions, NO_FILTERS, parseSavedFilters, toggleFilter } from "./metaFilter";
import type { DocumentMeta } from "./types";

const doc = (location: string, status: string | null, tags: string[] = []): DocumentMeta => ({
  id: location,
  filename: location,
  location,
  title: location,
  created: "",
  headings: [],
  ...(status === null && tags.length === 0 ? {} : { meta: { status, statusDetail: null, date: null, people: [], tags, statusLine: null } }),
});

const docs = [
  doc("a.md", "accepted", ["queue"]),
  doc("b.md", "proposed", ["queue", "auth"]),
  doc("c.md", "superseded", ["retries"]),
  doc("d.md", "draft"),
  doc("e.md", null, ["auth"]),
  doc("f.md", null),
];
const names = (list: DocumentMeta[]) => list.map((d) => d.location);

describe("filterByMeta", () => {
  it("keeps everything without filters", () => {
    expect(filterByMeta(docs, NO_FILTERS)).toBe(docs);
  });

  it("matches any chosen status", () => {
    expect(names(filterByMeta(docs, { statuses: ["accepted", "draft"], tags: [], unread: false, branch: false }))).toEqual(["a.md", "d.md"]);
  });

  it("matches any chosen tag", () => {
    expect(names(filterByMeta(docs, { statuses: [], tags: ["auth", "retries"], unread: false, branch: false }))).toEqual(["b.md", "c.md", "e.md"]);
  });

  it("keeps documents changed on the branch when that's on, and all of them without git state", () => {
    const branch = { ...NO_FILTERS, branch: true };
    expect(names(filterByMeta(docs, branch, new Set(), null, new Set(["c.md"])))).toEqual(["c.md"]);
    // The open document isn't kept: it isn't about to change state as an unread one is
    expect(names(filterByMeta(docs, branch, new Set(), "a.md", new Set(["c.md"])))).toEqual(["c.md"]);
    expect(names(filterByMeta(docs, branch, new Set(), null, null))).toEqual(names(docs));
  });

  it("keeps unread documents, and the open one, when Unread is on", () => {
    const unread = { ...NO_FILTERS, unread: true };
    expect(names(filterByMeta(docs, unread, new Set(["b.md", "d.md"])))).toEqual(["b.md", "d.md"]);
    expect(names(filterByMeta(docs, unread, new Set(["b.md"]), "a.md"))).toEqual(["a.md", "b.md"]);
    expect(names(filterByMeta(docs, { ...unread, tags: ["auth"] }, new Set(["b.md", "d.md"])))).toEqual(["b.md"]);
  });

  it("needs both a chosen status and a chosen tag when both are set", () => {
    expect(names(filterByMeta(docs, { statuses: ["accepted", "proposed"], tags: ["auth"], unread: false, branch: false }))).toEqual(["b.md"]);
  });
});

describe("filterOptions", () => {
  it("counts statuses in MADR's order then A–Z, and tags most used first", () => {
    const options = filterOptions([...docs, doc("g.md", "accepted", ["auth"]), doc("h.md", "beta")]);
    expect(options.statuses).toEqual([
      { value: "proposed", count: 1 },
      { value: "accepted", count: 2 },
      { value: "superseded", count: 1 },
      { value: "beta", count: 1 },
      { value: "draft", count: 1 },
    ]);
    expect(options.tags).toEqual([
      { value: "auth", count: 3 },
      { value: "queue", count: 2 },
      { value: "retries", count: 1 },
    ]);
  });

  it("offers chosen values no document has", () => {
    const options = filterOptions([doc("a.md", "accepted")], { statuses: ["rejected"], tags: ["gone"], unread: false, branch: false });
    expect(options.statuses).toEqual([
      { value: "accepted", count: 1 },
      { value: "rejected", count: 0 },
    ]);
    expect(options.tags).toEqual([{ value: "gone", count: 0 }]);
  });
});

describe("toggleFilter", () => {
  it("adds and removes values", () => {
    const one = toggleFilter(NO_FILTERS, "status", "accepted");
    expect(one).toEqual({ statuses: ["accepted"], tags: [], unread: false, branch: false });
    expect(toggleFilter(one, "status", "accepted")).toEqual(NO_FILTERS);
    expect(toggleFilter(one, "tag", "queue")).toEqual({ statuses: ["accepted"], tags: ["queue"], unread: false, branch: false });
  });
});

describe("parseSavedFilters", () => {
  it("reads filters per workspace", () => {
    const saved = parseSavedFilters(JSON.stringify({ "/w": { statuses: ["accepted"], tags: ["queue"] } }));
    expect(saved.get("/w")).toEqual({ statuses: ["accepted"], tags: ["queue"], unread: false, branch: false });
  });

  it("remembers Unread", () => {
    const saved = parseSavedFilters(JSON.stringify({ "/w": { unread: true } }));
    expect(saved.get("/w")).toEqual({ statuses: [], tags: [], unread: true, branch: false });
  });

  it("remembers Changed on this branch", () => {
    const saved = parseSavedFilters(JSON.stringify({ "/w": { branch: true } }));
    expect(saved.get("/w")).toEqual({ statuses: [], tags: [], unread: false, branch: true });
  });

  it("drops malformed entries and storage", () => {
    const saved = parseSavedFilters(JSON.stringify({ a: { statuses: [1, ""], tags: "x" }, b: null, c: { tags: ["ok", 2] } }));
    expect([...saved]).toEqual([["c", { statuses: [], tags: ["ok"], unread: false, branch: false }]]);
    expect(parseSavedFilters("not json").size).toBe(0);
    expect(parseSavedFilters("[1]").size).toBe(0);
    expect(parseSavedFilters(null).size).toBe(0);
  });
});
