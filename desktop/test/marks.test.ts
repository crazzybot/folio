import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fingerprint, listMarks, MarkError, MarksStore, realPath, recordId } from "../src/marks";
import { scanWorkspace, stableId } from "../src/scanner";
import { FIXTURES, SKIP, WORKSPACE } from "./fixtures";

const MARKS = path.join(FIXTURES, "marks");
const PLAIN = path.join(WORKSPACE, "docs", "plain.md");
const README = path.join(WORKSPACE, "README.md");

/** A fixture record's path with {WORKSPACE} replaced by the real workspace path. */
function fixturePath(p: string): string {
  if (!p.startsWith("{WORKSPACE}/")) return p;
  return realPath(path.join(WORKSPACE, ...p.slice("{WORKSPACE}/".length).split("/")));
}

/** A fixture fingerprint field with {SHA1 …} / {SIZE …} replaced by that document's. */
function fingerprintValue(value: unknown): unknown {
  const match = typeof value === "string" ? /^\{(SHA1|SIZE) ([^}]+)\}$/.exec(value) : null;
  if (match === null) return value;
  const data = readFileSync(path.join(WORKSPACE, ...(match[2] as string).split("/")));
  return match[1] === "SHA1" ? createHash("sha1").update(data).digest("hex") : data.length;
}

function expectedListing(): unknown {
  const raw = readFileSync(path.join(MARKS, "expected-listing.json"), "utf8")
    .replace(/\{ID ([^}]+)\}/g, (_m, location: string) => stableId(location))
    .replace(/\{RECORD ([^}]+)\}/g, (_m, location: string) => recordId(path.join(WORKSPACE, ...location.split("/"))));
  return JSON.parse(raw);
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
    if (record.fingerprint) {
      record.fingerprint = Object.fromEntries(
        Object.entries(record.fingerprint).map(([k, v]) => [k, fingerprintValue(v)]),
      );
    }
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
    const docs = await scanWorkspace(WORKSPACE, SKIP);
    expect(await listMarks(store, WORKSPACE, docs)).toEqual(expectedListing());
  });

  it("finds the same marks from a subfolder workspace", async () => {
    const docsFolder = path.join(WORKSPACE, "docs");
    const listing = await listMarks(store, docsFolder, await scanWorkspace(docsFolder, SKIP));
    expect(listing.documents.map((d) => [d.location, d.docId])).toEqual([
      ["front-matter.md", stableId("front-matter.md")],
      ["guides/setup.markdown", stableId("guides/setup.markdown")],
      ["html-title.md", stableId("html-title.md")],
      ["plain.md", stableId("plain.md")],
    ]);
    expect(listing.missing.map((m) => m.location)).toEqual(["gone.md", "old/front-matter-untitled.md"]);
  });
});

describe("MarksStore", () => {
  it("adds, updates and deletes a highlight", async () => {
    const added = await store.addHighlight(PLAIN, highlight({ note: "  " }));
    expect([added.color, added.note, added.id.length]).toEqual(["yellow", null, 16]);

    const record = recordOf(PLAIN) as { highlights: { id: string }[]; path: string; fingerprint: Record<string, unknown> };
    expect(record.highlights.map((h) => h.id)).toEqual(["a1b2c3d4e5f60718", added.id]);
    expect(record.path).toBe(realPath(PLAIN));
    expect(record.fingerprint["filename"]).toBe("plain.md");
    expect(record.fingerprint["size"]).toBe(readFileSync(PLAIN).length);

    const changed = await store.updateHighlight(PLAIN, added.id, { color: "pink", note: "Why?" });
    expect([changed.color, changed.note]).toEqual(["pink", "Why?"]);

    await store.deleteHighlight(PLAIN, added.id);
    await store.deleteHighlight(PLAIN, "a1b2c3d4e5f60718");
    // The document bookmark keeps the record
    expect(recordOf(PLAIN)).not.toBeNull();
    await store.deleteBookmark(PLAIN, "b0b1b2b3b4b5b6b7");
    // No marks left: the record is removed
    expect(recordOf(PLAIN)).toBeNull();
  });

  it("adds and deletes bookmarks", async () => {
    const heading = { text: "Second line", level: 2, occurrence: 1 };
    const bookmark = await store.addBookmark(PLAIN, { heading });
    expect([bookmark.heading, bookmark.id.length]).toEqual([heading, 16]);
    // Bookmarking again returns the same bookmark
    expect(await store.addBookmark(PLAIN, { heading })).toEqual(bookmark);
    expect((await store.addBookmark(PLAIN, { heading: null })).id).toBe("b0b1b2b3b4b5b6b7");
    const record = recordOf(PLAIN) as { bookmarks: { id: string }[] };
    expect(record.bookmarks.map((b) => b.id)).toEqual(["b0b1b2b3b4b5b6b7", bookmark.id]);

    await store.deleteBookmark(PLAIN, bookmark.id);
    expect(await refusal(() => store.deleteBookmark(PLAIN, bookmark.id))).toBe(404);
  });

  it("creates the record of a document bookmarked without other marks", async () => {
    const file = path.join(WORKSPACE, "docs", "blank.md");
    await store.addBookmark(file, { heading: null });
    expect((recordOf(file) as { highlights: unknown[] }).highlights).toEqual([]);
  });

  const invalidBookmarks = JSON.parse(readFileSync(path.join(MARKS, "invalid-bookmarks.json"), "utf8")) as [string, unknown][];
  it.each(invalidBookmarks)("refuses a bookmark with %s", async (_name, body) => {
    const before = recordOf(PLAIN);
    expect(await refusal(() => store.addBookmark(PLAIN, body))).toBe(400);
    expect(recordOf(PLAIN)).toEqual(before);
  });

  const invalid = JSON.parse(readFileSync(path.join(MARKS, "invalid-highlights.json"), "utf8")) as [string, unknown][];
  it.each(invalid)("refuses %s", async (_name, body) => {
    const before = recordOf(PLAIN);
    expect(await refusal(() => store.addHighlight(PLAIN, body))).toBe(400);
    expect(recordOf(PLAIN)).toEqual(before);
  });

  it("refuses an invalid colour change", async () => {
    expect(await refusal(() => store.updateHighlight(PLAIN, "a1b2c3d4e5f60718", { color: "red" }))).toBe(400);
  });

  it("leaves records of a newer version alone", async () => {
    const file = path.join(dataDir, "marks", `${recordId(README)}.json`);
    const before = readFileSync(file, "utf8");
    expect(await refusal(() => store.addHighlight(README, highlight()))).toBe(409);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("leaves damaged records alone", async () => {
    const file = path.join(dataDir, "marks", `${recordId(PLAIN)}.json`);
    writeFileSync(file, "{ not json");
    const listed = (await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP))).documents;
    expect(listed.map((d) => d.location)).not.toContain("docs/plain.md");
    expect(await refusal(() => store.addHighlight(PLAIN, highlight()))).toBe(409);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("404s unknown highlights", async () => {
    expect(await refusal(() => store.deleteHighlight(PLAIN, "nope"))).toBe(404);
    expect(await refusal(() => store.updateHighlight(PLAIN, "nope", { color: "blue" }))).toBe(404);
  });

  it("keeps every highlight when several are added at once", async () => {
    await Promise.all([1, 2, 3].map(() => store.addHighlight(PLAIN, highlight())));
    expect((recordOf(PLAIN) as { highlights: unknown[] }).highlights).toHaveLength(4);
  });

  it("ignores case in record ids only where the file system does", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "folio-case-"));
    writeFileSync(path.join(folder, "Note.md"), "x");
    const same = recordId(path.join(folder, "note.md")) === recordId(path.join(folder, "Note.md"));
    expect(same).toBe(process.platform === "darwin" || process.platform === "win32");
  });
});

describe("moved and deleted documents", () => {
  const at = (location: string) => path.join(WORKSPACE, ...location.split("/"));
  const listing = async () => listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP));

  it("moves an unedited file's marks by itself", async () => {
    await listing();
    const record = recordOf(at("docs/html-title.md")) as { path: string; highlights: { id: string }[] };
    expect(record.path).toBe(realPath(at("docs/html-title.md")));
    expect(record.highlights.map((h) => h.id)).toEqual(["e0e1e2e3e4e5e6e7"]);
    expect(existsSync(path.join(dataDir, "marks", `${recordId(at("docs/archive/html-title.md"))}.json`))).toBe(false);
  });

  it("moves marks to a chosen document", async () => {
    await store.relink(recordId(at("docs/old/front-matter-untitled.md")), at("docs/front-matter-untitled.md"));
    const after = await listing();
    expect(after.missing.map((m) => m.location)).toEqual(["docs/gone.md"]);
    const moved = after.documents.find((d) => d.location === "docs/front-matter-untitled.md");
    expect(moved?.highlights.map((h) => h.id)).toEqual(["f0f1f2f3f4f5f6f7"]);
  });

  it("merges moved marks with the document's own", async () => {
    await store.relink(recordId(at("docs/gone.md")), PLAIN);
    const record = recordOf(PLAIN) as { highlights: { id: string }[]; bookmarks: { id: string }[] };
    expect(record.highlights.map((h) => h.id)).toEqual(["a1b2c3d4e5f60718", "a0a1a2a3a4a5a6a7"]);
    expect(record.bookmarks.map((b) => b.id)).toEqual(["b0b1b2b3b4b5b6b7"]);
  });

  it("deletes a missing document's marks", async () => {
    await store.forget(recordId(at("docs/gone.md")));
    expect((await listing()).missing.map((m) => m.location)).toEqual(["docs/old/front-matter-untitled.md"]);
  });

  it("refuses record ids it didn't make", async () => {
    expect(await refusal(() => store.forget("../secret"))).toBe(404);
    expect(await refusal(() => store.relink("0".repeat(40), PLAIN))).toBe(404);
  });

  it("fingerprints the file's bytes", async () => {
    // Windows line endings count as stored
    const folder = mkdtempSync(path.join(os.tmpdir(), "folio-crlf-"));
    const file = path.join(folder, "crlf.md");
    writeFileSync(file, "one\r\ntwo\r\n");
    expect(await fingerprint(file)).toEqual({
      sha1: createHash("sha1").update("one\r\ntwo\r\n").digest("hex"),
      size: 10,
      filename: "crlf.md",
    });
  });

  it("gives a missing file the same record id as the former Python backend", () => {
    // Folders that still exist are resolved, as Python's os.path.realpath does
    expect(realPath(at("docs/gone/deeper.md"))).toBe(path.join(realPath(at("docs")), "gone", "deeper.md"));
  });

  // ── The document's note ──────────────────────────────────────────────────

  const NOTED = path.join(WORKSPACE, "docs", "front-matter.md");
  const BLANK = path.join(WORKSPACE, "docs", "blank.md"); // no marks

  it("sets, updates and removes a document note", async () => {
    const note = await store.setNote(BLANK, { text: "Overall fine.", requestedStatus: " accepted " });
    expect([note?.text, note?.requestedStatus]).toEqual(["Overall fine.", "accepted"]);
    const listing = await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP));
    const listed = listing.documents.find((d) => d.docId === stableId("docs/blank.md"));
    expect([listed?.note, listed?.bookmarks, listed?.highlights]).toEqual([note, [], []]);

    const updated = await store.setNote(BLANK, { text: null, requestedStatus: "rejected" });
    expect([updated?.text, updated?.requestedStatus, updated?.created]).toEqual([null, "rejected", note?.created]);

    // Nothing left: the note goes, and the record with it
    expect(await store.setNote(BLANK, { text: "  ", requestedStatus: null })).toBeNull();
    expect(recordOf(BLANK)).toBeNull();
    expect(await refusal(() => store.deleteNote(BLANK))).toBe(404);
  });

  it("keeps a note and unknown fields when marks change", async () => {
    const added = await store.addHighlight(NOTED, highlight());
    await store.deleteHighlight(NOTED, added.id);
    const record = recordOf(NOTED) as { documentNote: { requestedStatus: string }; futureField: unknown };
    expect(record.documentNote.requestedStatus).toBe("accepted");
    expect(record.futureField).toEqual({ kept: true });

    await store.deleteNote(NOTED);
    expect(recordOf(NOTED)).toBeNull();
  });

  it("moves a note with a missing document's marks", async () => {
    await store.relink(recordId(path.join(WORKSPACE, "docs", "gone.md")), NOTED);
    const note = (recordOf(NOTED) as { documentNote: Record<string, unknown> }).documentNote;
    // The document's own status request stays; the moved comment goes below its own
    expect(note["text"]).toBe("Ready once the title matches the heading.\n\nWas this replaced by something?");
    expect([note["requestedStatus"], note["created"]]).toEqual(["accepted", "2026-11-08T09:00:00Z"]);
  });

  it("moves a note to a document without one", async () => {
    await store.relink(recordId(path.join(WORKSPACE, "docs", "gone.md")), PLAIN);
    expect((recordOf(PLAIN) as { documentNote: { text: string } }).documentNote.text).toBe("Was this replaced by something?");
  });

  const invalidNotes = JSON.parse(readFileSync(path.join(MARKS, "invalid-notes.json"), "utf8")) as [string, unknown][];
  it.each(invalidNotes)("refuses a note with %s", async (_name, body) => {
    const before = recordOf(NOTED);
    expect(await refusal(() => store.setNote(NOTED, body))).toBe(400);
    expect(recordOf(NOTED)).toEqual(before);
  });
});
