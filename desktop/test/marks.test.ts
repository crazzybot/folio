import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listMarks, MarkError, MarksStore, realPath, recordId } from "../src/marks";
import { scanWorkspace, stableId } from "../src/scanner";
import { FIXTURES, SKIP, WORKSPACE } from "./fixtures";

// The backend's store must behave the same (backend/tests/test_marks.py)
const MARKS = path.join(FIXTURES, "marks");
const PLAIN = path.join(WORKSPACE, "docs", "plain.md");
const README = path.join(WORKSPACE, "README.md");
const plainContent = () => readFileSync(PLAIN, "utf8");

/** A fixture record's path with {WORKSPACE} replaced by the real workspace path. */
function fixturePath(p: string): string {
  if (!p.startsWith("{WORKSPACE}/")) return p;
  return realPath(path.join(WORKSPACE, ...p.slice("{WORKSPACE}/".length).split("/")));
}

let dataDir: string;
let store: MarksStore;

beforeEach(() => {
  // A data folder holding the fixture records, each under its real record id
  dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-marks-"));
  const folder = path.join(dataDir, "marks");
  mkdirSync(folder);
  for (const name of readdirSync(path.join(MARKS, "records")).sort()) {
    const record = JSON.parse(readFileSync(path.join(MARKS, "records", name), "utf8"));
    record.path = fixturePath(record.path);
    const id = record.path.startsWith(realPath(WORKSPACE)) ? recordId(record.path) : name.replace(/\.json$/, "");
    writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(record));
  }
  store = new MarksStore(dataDir);
});

function recordOf(file: string): Record<string, unknown> | null {
  const p = path.join(dataDir, "marks", `${recordId(file)}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

const highlight = (changes: Record<string, unknown> = {}) => ({
  color: "yellow",
  quote: { exact: "No headings", prefix: "", suffix: " here." },
  position: { start: 0, end: 11 },
  ...changes,
});

async function refusal(promise: () => Promise<unknown>): Promise<number | null> {
  try {
    await promise();
    return null;
  } catch (err) {
    return err instanceof MarkError ? err.status : -1;
  }
}

describe("listMarks", () => {
  it("lists the workspace marks like the shared fixture", async () => {
    const expected = JSON.parse(readFileSync(path.join(MARKS, "expected-listing.json"), "utf8"));
    expected.documents[0].docId = stableId("docs/plain.md");
    const docs = await scanWorkspace(WORKSPACE, SKIP);
    expect(await listMarks(store, WORKSPACE, docs)).toEqual(expected);
  });

  it("finds the same marks from a subfolder workspace", async () => {
    const docsFolder = path.join(WORKSPACE, "docs");
    const listing = await listMarks(store, docsFolder, await scanWorkspace(docsFolder, SKIP));
    expect(listing.documents.map((d) => [d.location, d.docId])).toEqual([["plain.md", stableId("plain.md")]]);
  });
});

describe("MarksStore", () => {
  it("adds, updates and deletes a highlight", async () => {
    const added = await store.addHighlight(PLAIN, plainContent(), highlight({ note: "  " }));
    expect([added.color, added.note, added.id.length]).toEqual(["yellow", null, 16]);

    const record = recordOf(PLAIN) as { highlights: { id: string }[]; path: string; fingerprint: Record<string, unknown> };
    expect(record.highlights.map((h) => h.id)).toEqual(["a1b2c3d4e5f60718", added.id]);
    expect(record.path).toBe(realPath(PLAIN));
    expect(record.fingerprint["filename"]).toBe("plain.md");
    expect(record.fingerprint["size"]).toBe(readFileSync(PLAIN).length);

    const changed = await store.updateHighlight(PLAIN, plainContent(), added.id, { color: "pink", note: "Why?" });
    expect([changed.color, changed.note]).toEqual(["pink", "Why?"]);

    await store.deleteHighlight(PLAIN, plainContent(), added.id);
    await store.deleteHighlight(PLAIN, plainContent(), "a1b2c3d4e5f60718");
    // No marks left: the record is removed
    expect(recordOf(PLAIN)).toBeNull();
  });

  const invalid = JSON.parse(readFileSync(path.join(MARKS, "invalid-highlights.json"), "utf8")) as [string, unknown][];
  it.each(invalid)("refuses %s", async (_name, body) => {
    const before = recordOf(PLAIN);
    expect(await refusal(() => store.addHighlight(PLAIN, plainContent(), body))).toBe(400);
    expect(recordOf(PLAIN)).toEqual(before);
  });

  it("refuses an invalid colour change", async () => {
    expect(await refusal(() => store.updateHighlight(PLAIN, plainContent(), "a1b2c3d4e5f60718", { color: "red" }))).toBe(400);
  });

  it("leaves records of a newer version alone", async () => {
    const file = path.join(dataDir, "marks", `${recordId(README)}.json`);
    const before = readFileSync(file, "utf8");
    expect(await refusal(() => store.addHighlight(README, readFileSync(README, "utf8"), highlight()))).toBe(409);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("leaves damaged records alone", async () => {
    const file = path.join(dataDir, "marks", `${recordId(PLAIN)}.json`);
    writeFileSync(file, "{ not json");
    expect((await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP))).documents).toEqual([]);
    expect(await refusal(() => store.addHighlight(PLAIN, plainContent(), highlight()))).toBe(409);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("404s unknown highlights", async () => {
    expect(await refusal(() => store.deleteHighlight(PLAIN, plainContent(), "nope"))).toBe(404);
    expect(await refusal(() => store.updateHighlight(PLAIN, plainContent(), "nope", { color: "blue" }))).toBe(404);
  });

  it("keeps every highlight when several are added at once", async () => {
    await Promise.all([1, 2, 3].map(() => store.addHighlight(PLAIN, plainContent(), highlight())));
    expect((recordOf(PLAIN) as { highlights: unknown[] }).highlights).toHaveLength(4);
  });

  it("ignores case in record ids only where the file system does", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "folio-case-"));
    writeFileSync(path.join(folder, "Note.md"), "x");
    const same = recordId(path.join(folder, "note.md")) === recordId(path.join(folder, "Note.md"));
    expect(same).toBe(process.platform === "darwin" || process.platform === "win32");
  });
});
