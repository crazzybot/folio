/**
 * The live demo's in-page search (frontend/src/demo/search.ts) must find
 * what the desktop app's does: both run on the same inputs here.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as demo from "../../frontend/src/demo/search";
import { scanWorkspace } from "../../packages/core/src/scanner";
import { searchContent, searchWorkspace } from "../src/search";
import { SKIP, WORKSPACE } from "./fixtures";

const LINES = [
  "foo\nbar FOO foo\nfoo",
  "x".repeat(100) + " needle " + "y".repeat(120),
  "    indented needle\r\nwindows line endings NEEDLE",
  "needle".repeat(10),
  "ünïcödé Straße STRASSE straße",
  "",
];

describe("demo search", () => {
  it("matches lines like the desktop app", () => {
    for (const content of LINES) {
      for (const needle of ["foo", "needle", "straße", "e", "nothing"]) {
        expect(demo.searchContent(content, needle), `${JSON.stringify(content)} / ${needle}`).toEqual(
          searchContent(content, needle),
        );
      }
    }
  });

  it("finds the same documents in the shared fixture workspace", async () => {
    const docs = await scanWorkspace(WORKSPACE, SKIP);
    const contents: Record<string, string> = {};
    for (const doc of docs) contents[doc.id] = await fs.readFile(path.join(WORKSPACE, doc.location), "utf8");
    for (const query of ["heading", "  Heading ", "the", "a", "Vendored", "x".repeat(300), "[[", "é"]) {
      expect(demo.searchDocuments(docs, contents, query), query).toEqual(await searchWorkspace(WORKSPACE, query, SKIP));
    }
  });
});
