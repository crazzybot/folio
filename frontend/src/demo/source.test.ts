import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoSource, type DemoBundle } from "./source";

const bundle: DemoBundle = {
  documents: [
    { id: "a", filename: "a.md", location: "docs/a.md", title: "Alpha", created: "2026-11-01T00:00:00Z", headings: [] },
    { id: "b", filename: "b.md", location: "docs/b.md", title: "Beta", created: "2026-11-01T00:00:00Z", headings: [] },
  ],
  contents: { a: "# Alpha\n\nThe lease expires.", b: "# Beta\n\nNo match here.\nLEASE again, lease." },
  attachments: ["img/diagram.png"],
  seedMarks: {},
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(bundle), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDemoSource", () => {
  it("reads the bundle once, from next to the app", async () => {
    const source = createDemoSource("./", null);
    expect((await source.listDocuments()).map((d) => d.title)).toEqual(["Alpha", "Beta"]);
    expect(await source.listAttachments()).toEqual(["img/diagram.png"]);
    expect(await source.getDocumentContent("b")).toEqual({
      id: "b",
      content: bundle.contents["b"],
      // What the desktop app records for the file's bytes
      sha1: "f0aa02246186c9cfc40644d403f862dab2010936",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("./bundle.json");
  });

  it("keeps read records in the browser: a baseline, then read and unread", async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    };
    const source = createDemoSource("./", storage);
    const first = await source.reads.list();
    expect(first.map((d) => [d.docId, d.read?.sha1 === d.sha1, d.baseline])).toEqual([
      ["a", true, true],
      ["b", true, true],
    ]);
    await source.reads.unmark("a");
    await expect(source.reads.mark("b", "0".repeat(40))).rejects.toThrow("changed");
    // A new visit starts from what was kept
    const again = await createDemoSource("./", storage).reads.list();
    expect(again.map((d) => [d.docId, d.read === null])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    const { sha1 } = await source.getDocumentContent("a");
    await source.reads.mark("a", sha1 ?? "");
    expect((await source.reads.list())[0]?.read?.sha1).toBe(sha1);
  });

    it("starts a document read before the seeded round as changed, with that version to compare", async () => {
    const before = "# Alpha\n\nThe lease ends.";
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ...bundle, readVersions: { a: { text: before, at: "2026-11-12T16:20:00Z" } } }), { status: 200 }),
    );
    const source = createDemoSource("./", null);
    const [a, b] = await source.reads.list();
    expect([a?.read?.at, a?.baseline, a?.read?.sha1 === a?.sha1]).toEqual(["2026-11-12T16:20:00Z", false, false]);
    expect(b?.read?.sha1 === b?.sha1).toBe(true);
    expect(await source.reads.snapshot("a")).toBe(before);
    // Read now, then reset: changed again
    await source.reads.mark("a", a?.sha1 ?? "");
    expect(await source.reads.snapshot("a")).toBe(bundle.contents["a"]);
    await source.resetMarks();
    expect((await source.reads.list())[0]?.read?.sha1 === a?.sha1).toBe(false);
  });

    it("refuses a document that isn't in the bundle", async () => {
    await expect(createDemoSource("./", null).getDocumentContent("zzz")).rejects.toThrow("not found");
  });

  it("serves workspace files from the static copy", () => {
    expect(createDemoSource("/folio/demo/", null).workspaceFileUrl("img/a%20b.png")).toBe(
      "/folio/demo/workspace/img/a%20b.png",
    );
  });

  it("searches the documents' text in list order", async () => {
    const results = await createDemoSource("./", null).searchDocuments("lease");
    expect(results.map((r) => [r.id, r.matchCount])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(await createDemoSource("./", null).searchDocuments("l")).toEqual([]);
  });

  it("keeps marks, and resets them", async () => {
    const source = createDemoSource("./", null);
    const anchor = { quote: { exact: "lease", prefix: "The ", suffix: " expires" }, position: { start: 10, end: 15 } };
    await source.marks.addHighlight("a", { ...anchor, color: "yellow", note: "Hm" });
    expect((await source.marks.list()).documents.map((d) => d.docId)).toEqual(["a"]);
    await source.resetMarks();
    expect((await source.marks.list()).documents).toEqual([]);
  });

  it("tries the bundle again after a failed fetch", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503, statusText: "Unavailable" }));
    const source = createDemoSource("./", null);
    await expect(source.listDocuments()).rejects.toThrow("HTTP 503");
    expect(await source.listDocuments()).toHaveLength(2);
  });
});
