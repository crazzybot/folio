import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "folio-custom-css-"));
vi.mock("electron", () => ({ app: { getPath: () => dir } }));
const { customCssPath, ensureCustomCss, readCustomCss } = await import("../src/customCss");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("custom.css", () => {
  it("is absent until created", () => {
    expect(readCustomCss()).toBeNull();
  });

  it("is created from a commented-out template, applying nothing yet", () => {
    expect(ensureCustomCss()).toBe(customCssPath());
    const css = readFileSync(customCssPath(), "utf8");
    expect(css).toContain(".folio-document");
    // Every rule in the template is inside a comment
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe("");
  });

  it("keeps the user's file when it already exists", () => {
    writeFileSync(customCssPath(), "h1 { color: red; }");
    ensureCustomCss();
    expect(readCustomCss()).toBe("h1 { color: red; }");
  });

  it("ignores a file too large to be a stylesheet", () => {
    writeFileSync(customCssPath(), "x".repeat(512 * 1024 + 1));
    expect(readCustomCss()).toBeNull();
  });
});
