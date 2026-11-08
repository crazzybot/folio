import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Api from "./api";

// api.ts picks its data source when it loads: no desktop bridge here, so the
// REST backend, reached through a stubbed fetch
const fetchMock = vi.fn<typeof fetch>();
let api: typeof Api;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  api = await import("./api");
});

beforeEach(() => {
  fetchMock.mockReset();
  respondWith(200);
});

/** Answer every request with `status` (a fresh Response each time: a body reads once). */
function respondWith(status: number, statusText = ""): void {
  fetchMock.mockImplementation(async () =>
    status === 204 ? new Response(null, { status }) : new Response("{}", { status, statusText }),
  );
}

/** The URL, method and JSON body of the only request made. */
function request(): { url: string; method: string; body: unknown } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: String(url),
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

const anchor = { quote: { exact: "two", prefix: "one ", suffix: " three" }, position: { start: 4, end: 7 } };

describe("REST backend requests", () => {
  it("reads documents, attachments, content and search results", async () => {
    await api.fetchDocuments();
    expect(request()).toEqual({ url: "/api/documents", method: "GET", body: undefined });

    fetchMock.mockClear();
    await api.fetchAttachments();
    expect(request().url).toBe("/api/attachments");

    fetchMock.mockClear();
    await api.fetchDocumentContent("a/b");
    expect(request().url).toBe("/api/documents/a%2Fb/content");

    fetchMock.mockClear();
    await api.searchDocuments("rate & limit");
    expect(request().url).toBe("/api/search?q=rate%20%26%20limit");
  });

  it("encodes each segment of a workspace file's location", () => {
    expect(api.workspaceFileUrl("img/a b#1.png")).toBe("/api/files/img/a%20b%231.png");
  });

  it("adds, changes and removes highlights", async () => {
    await api.addHighlight("d1", anchor, "green", "Why?");
    expect(request()).toEqual({
      url: "/api/documents/d1/highlights",
      method: "POST",
      body: { ...anchor, color: "green", note: "Why?" },
    });

    fetchMock.mockClear();
    await api.addHighlight("d1", anchor, "yellow");
    expect(request().body).toEqual({ ...anchor, color: "yellow", note: null });

    fetchMock.mockClear();
    await api.updateHighlight("d1", "h1", { note: null });
    expect(request()).toEqual({ url: "/api/documents/d1/highlights/h1", method: "PATCH", body: { note: null } });

    fetchMock.mockClear();
    respondWith(204);
    await api.deleteHighlight("d1", "h1");
    expect(request()).toEqual({ url: "/api/documents/d1/highlights/h1", method: "DELETE", body: undefined });
  });

  it("adds and removes bookmarks", async () => {
    const heading = { text: "Storage", level: 2, occurrence: 0 };
    await api.addBookmark("d1", heading);
    expect(request()).toEqual({ url: "/api/documents/d1/bookmarks", method: "POST", body: { heading } });

    fetchMock.mockClear();
    await api.addBookmark("d1", null);
    expect(request().body).toEqual({ heading: null });

    fetchMock.mockClear();
    respondWith(204);
    await api.deleteBookmark("d1", "b1");
    expect(request()).toEqual({ url: "/api/documents/d1/bookmarks/b1", method: "DELETE", body: undefined });
  });

  it("lists, relinks and forgets marks", async () => {
    await api.fetchMarks();
    expect(request().url).toBe("/api/marks");

    fetchMock.mockClear();
    respondWith(204);
    await api.relinkMarks("r1", "d2");
    expect(request()).toEqual({ url: "/api/marks/r1/relink", method: "POST", body: { docId: "d2" } });

    fetchMock.mockClear();
    await api.forgetMarks("r1");
    expect(request()).toEqual({ url: "/api/marks/r1", method: "DELETE", body: undefined });
  });

  it("sends JSON bodies as JSON", async () => {
    await api.addBookmark("d1", null);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("rejects on an error status", async () => {
    respondWith(409, "Conflict");
    await expect(api.addHighlight("d1", anchor, "blue")).rejects.toThrow("HTTP 409: Conflict");
    await expect(api.deleteBookmark("d1", "b1")).rejects.toThrow("HTTP 409: Conflict");
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
