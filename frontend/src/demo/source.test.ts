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
    expect(await source.getDocumentContent("b")).toEqual({ id: "b", content: bundle.contents["b"] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("./bundle.json");
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
