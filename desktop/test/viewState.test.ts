import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "folio-view-state-"));
vi.mock("electron", () => ({ app: { getPath: () => dir } }));

const { hasPendingViewState, loadViewState, saveViewState, setViewState, viewStateSnapshot } = await import("../src/viewState");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("view state", () => {
  it("stores string values, saves them, and loads them back", () => {
    setViewState("folio.sidebar", '{"width":340}');
    setViewState("folio.outline", "false");
    expect(hasPendingViewState()).toBe(true);
    saveViewState();
    expect(hasPendingViewState()).toBe(false);
    expect(JSON.parse(readFileSync(path.join(dir, "view-state.json"), "utf8"))).toEqual({
      "folio.sidebar": '{"width":340}',
      "folio.outline": "false",
    });
    loadViewState();
    expect(viewStateSnapshot()["folio.sidebar"]).toBe('{"width":340}');
  });

  it("ignores values that aren't short strings", () => {
    setViewState("bad", 42);
    setViewState(7, "x");
    setViewState("", "x");
    setViewState("k".repeat(101), "x");
    setViewState("huge", "x".repeat(64 * 1024 + 1));
    expect(Object.keys(viewStateSnapshot()).sort()).toEqual(["folio.outline", "folio.sidebar"]);
  });

  it("keeps at most 100 entries", () => {
    for (let i = 0; i < 150; i++) setViewState(`key${i}`, "v");
    expect(Object.keys(viewStateSnapshot())).toHaveLength(100);
    saveViewState();
  });
});
