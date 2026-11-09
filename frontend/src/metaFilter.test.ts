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
    expect(names(filterByMeta(docs, { statuses: ["accepted", "draft"], tags: [] }))).toEqual(["a.md", "d.md"]);
  });

  it("matches any chosen tag", () => {
    expect(names(filterByMeta(docs, { statuses: [], tags: ["auth", "retries"] }))).toEqual(["b.md", "c.md", "e.md"]);
  });

  it("needs both a chosen status and a chosen tag when both are set", () => {
    expect(names(filterByMeta(docs, { statuses: ["accepted", "proposed"], tags: ["auth"] }))).toEqual(["b.md"]);
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
    const options = filterOptions([doc("a.md", "accepted")], { statuses: ["rejected"], tags: ["gone"] });
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
    expect(one).toEqual({ statuses: ["accepted"], tags: [] });
    expect(toggleFilter(one, "status", "accepted")).toEqual(NO_FILTERS);
    expect(toggleFilter(one, "tag", "queue")).toEqual({ statuses: ["accepted"], tags: ["queue"] });
  });
});

describe("parseSavedFilters", () => {
  it("reads filters per workspace", () => {
    const saved = parseSavedFilters(JSON.stringify({ "/w": { statuses: ["accepted"], tags: ["queue"] } }));
    expect(saved.get("/w")).toEqual({ statuses: ["accepted"], tags: ["queue"] });
  });

  it("drops malformed entries and storage", () => {
    const saved = parseSavedFilters(JSON.stringify({ a: { statuses: [1, ""], tags: "x" }, b: null, c: { tags: ["ok", 2] } }));
    expect([...saved]).toEqual([["c", { statuses: [], tags: ["ok"] }]]);
    expect(parseSavedFilters("not json").size).toBe(0);
    expect(parseSavedFilters("[1]").size).toBe(0);
    expect(parseSavedFilters(null).size).toBe(0);
  });
});
