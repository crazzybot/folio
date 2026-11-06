import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "folio-settings-"));
vi.mock("electron", () => ({ app: { getPath: () => dir } }));

const { DEFAULT_SKIP_DIRS, loadSettings } = await import("../src/settings");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const withSaved = (settings: object) => {
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings));
  return loadSettings();
};

describe("skipDirs", () => {
  it("defaults to the full list without a settings file", () => {
    rmSync(path.join(dir, "settings.json"), { force: true });
    expect(loadSettings().skipDirs).toEqual(DEFAULT_SKIP_DIRS);
    expect(DEFAULT_SKIP_DIRS).toContain(".local");
  });

  it("upgrades a list left at the previous default, in any order", () => {
    expect(withSaved({ skipDirs: [".cache", ".git", "__pycache__", ".venv", "node_modules"] }).skipDirs).toEqual(DEFAULT_SKIP_DIRS);
  });

  it("keeps a customised list as it is", () => {
    expect(withSaved({ skipDirs: [".git", "node_modules", "dist"] }).skipDirs).toEqual([".git", "node_modules", "dist"]);
    expect(withSaved({ skipDirs: [".git", "node_modules", ".venv", "__pycache__", ".cache", "build"] }).skipDirs).toHaveLength(6);
  });

  it("falls back to the default for a malformed list", () => {
    expect(withSaved({ skipDirs: "nope" }).skipDirs).toEqual(DEFAULT_SKIP_DIRS);
  });
});
