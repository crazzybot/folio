import { symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIP, WORKSPACE } from "./fixtures";

const opened: string[] = [];
vi.mock("electron", () => ({ shell: { openPath: async (p: string) => (opened.push(p), "") } }));
const { openLinkedFile } = await import("../src/files");

// A symlink that gives an executable an allowed-looking name
const disguised = path.join(WORKSPACE, "docs", "disguised.pdf");
symlinkSync(path.join(WORKSPACE, "docs", "install.command"), disguised);
afterAll(() => rmSync(disguised, { force: true }));

beforeEach(() => {
  opened.length = 0;
});

describe("openLinkedFile", () => {
  it("opens allowed files inside the workspace", async () => {
    expect(await openLinkedFile(WORKSPACE, "docs/data.csv", SKIP.skipDirs)).toBe("opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/docs\/data\.csv$/);
  });

  it.each([
    ["docs/install.command", "not-allowed"],
    ["docs/page.html", "not-allowed"],
    ["docs/diagram.svg", "not-allowed"],
    ["docs/missing.pdf", "not-found"],
    ["../expected-scan.json", "not-found"],
    ["node_modules/pkg/skipped.png", "not-found"],
    ["docs/disguised.pdf", "not-allowed"],
  ])("refuses %s (%s)", async (location, result) => {
    expect(await openLinkedFile(WORKSPACE, location, SKIP.skipDirs)).toBe(result);
    expect(opened).toEqual([]);
  });

  it("opens nothing without a workspace", async () => {
    expect(await openLinkedFile(null, "docs/data.csv", SKIP.skipDirs)).toBe("not-found");
  });
});
