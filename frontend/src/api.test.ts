import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Api from "./api";

// api.ts picks its data source when it loads: no desktop bridge here, and
// not the demo build, so there are no documents. fetch is stubbed to check
// that nothing reaches the network.
const fetchMock = vi.fn<typeof fetch>();
let api: typeof Api;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  api = await import("./api");
});

beforeEach(() => {
  fetchMock.mockReset();
});

const anchor = { quote: { exact: "two", prefix: "one ", suffix: " three" }, position: { start: 4, end: 7 } };

describe("outside the desktop app", () => {
  it("says where Folio runs instead of loading anything", async () => {
    await expect(api.fetchDocuments()).rejects.toThrow(api.UNAVAILABLE_MESSAGE);
    await expect(api.searchDocuments("lease")).rejects.toThrow(api.UNAVAILABLE_MESSAGE);
    await expect(api.fetchMarks()).rejects.toThrow(api.UNAVAILABLE_MESSAGE);
    await expect(api.addHighlight("d1", anchor, "blue")).rejects.toThrow(api.UNAVAILABLE_MESSAGE);
    expect(api.workspaceFileUrl("img/a.png")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("desktop app", () => {
  it("goes over the IPC bridge, with the same arguments as before", async () => {
    const marks = {
      list: vi.fn(async () => ({ documents: [], missing: [] })),
      addHighlight: vi.fn(async () => ({})),
      updateHighlight: vi.fn(async () => ({})),
      deleteHighlight: vi.fn(async () => undefined),
      addBookmark: vi.fn(async () => ({})),
      deleteBookmark: vi.fn(async () => undefined),
      relink: vi.fn(async () => undefined),
      forget: vi.fn(async () => undefined),
    };
    const bridge = {
      workspaceFileBaseUrl: "app://workspace/",
      listDocuments: vi.fn(async () => []),
      listAttachments: vi.fn(async () => []),
      searchDocuments: vi.fn(async () => []),
      getDocumentContent: vi.fn(async () => ({ id: "d1", content: "" })),
      marks,
    };
    vi.resetModules();
    vi.stubGlobal("window", { markdownApi: bridge });
    const desktop = await import("./api");

    await desktop.fetchDocuments();
    await desktop.fetchAttachments();
    await desktop.searchDocuments("lease");
    await desktop.fetchDocumentContent("d1");
    expect(desktop.workspaceFileUrl("img/a b.png")).toBe("app://workspace/img/a%20b.png");
    await desktop.fetchMarks();
    await desktop.addHighlight("d1", anchor, "pink", "Hm");
    await desktop.updateHighlight("d1", "h1", { color: "blue" });
    await desktop.deleteHighlight("d1", "h1");
    await desktop.addBookmark("d1", null);
    await desktop.deleteBookmark("d1", "b1");
    await desktop.relinkMarks("r1", "d2");
    await desktop.forgetMarks("r1");

    expect(bridge.searchDocuments).toHaveBeenCalledWith("lease");
    expect(bridge.getDocumentContent).toHaveBeenCalledWith("d1");
    expect(marks.list).toHaveBeenCalledOnce();
    expect(marks.addHighlight).toHaveBeenCalledWith("d1", { ...anchor, color: "pink", note: "Hm" });
    expect(marks.updateHighlight).toHaveBeenCalledWith("d1", "h1", { color: "blue" });
    expect(marks.deleteHighlight).toHaveBeenCalledWith("d1", "h1");
    expect(marks.addBookmark).toHaveBeenCalledWith("d1", { heading: null });
    expect(marks.deleteBookmark).toHaveBeenCalledWith("d1", "b1");
    expect(marks.relink).toHaveBeenCalledWith("r1", "d2");
    expect(marks.forget).toHaveBeenCalledWith("r1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
