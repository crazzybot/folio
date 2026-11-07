import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPath, folderInWorkspace, locationInWorkspace, pathsFromArgv } from "../src/openPaths";
import { WORKSPACE } from "./fixtures";

describe("pathsFromArgv", () => {
  it("skips the executable, the app path in development, and switches", () => {
    expect(pathsFromArgv(["/x/Electron", ".", "--user-data-dir=/u", "notes/a.md", "-psn_0_1"], "/home/me", false)).toEqual([
      "/home/me/notes/a.md",
    ]);
    expect(pathsFromArgv(["/Apps/Folio", "../b.md", "docs"], "/home/me/w", true)).toEqual(["/home/me/b.md", "/home/me/w/docs"]);
  });
});

describe("classifyPath", () => {
  it.each([
    ["docs", "folder"],
    ["docs/plain.md", "markdown"],
    ["docs/guides/setup.markdown", "markdown"],
    ["docs/notes.txt", "other"],
    ["nope.md", "missing"],
  ])("%s is %s", async (location, kind) => {
    expect(await classifyPath(path.join(WORKSPACE, location))).toBe(kind);
  });
});

describe("locationInWorkspace", () => {
  it("gives the workspace-relative location, or null outside it", async () => {
    expect(await locationInWorkspace(path.join(WORKSPACE, "docs/plain.md"), WORKSPACE)).toBe("docs/plain.md");
    expect(await locationInWorkspace(path.join(WORKSPACE, "docs/outside-link.md"), WORKSPACE)).toBeNull();
    expect(await locationInWorkspace("/etc/hosts", WORKSPACE)).toBeNull();
  });
});

describe("folderInWorkspace", () => {
  it("gives the folder's path inside the workspace", async () => {
    expect(await folderInWorkspace(WORKSPACE, "docs")).toBe(path.join(WORKSPACE, "docs"));
    expect(await folderInWorkspace(WORKSPACE, "docs/guides")).toBe(path.join(WORKSPACE, "docs", "guides"));
  });

  it.each([
    ["a file", "docs/plain.md"],
    ["a missing folder", "nope"],
    ["the workspace itself", ""],
    ["a parent folder", ".."],
    ["a way out through ..", "docs/../../fixtures"],
    ["a symlink out", "docs/outside-link.md"],
  ])("is null for %s", async (_name, location) => {
    expect(await folderInWorkspace(WORKSPACE, location)).toBeNull();
  });
});
