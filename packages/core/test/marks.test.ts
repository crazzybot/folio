import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fingerprint, listMarks, MarkError, MarksStore, realPath, recordId } from "../src/marks";
import type { DocumentNote, Highlight } from "../src/marks";
import { scanWorkspace, stableId } from "../src/scanner";
import { FIXTURES, SKIP, WORKSPACE } from "./fixtures";

const MARKS = path.join(FIXTURES, "marks");
const PLAIN = path.join(WORKSPACE, "docs", "plain.md");
const README = path.join(WORKSPACE, "README.md");
const BLANK_DOC = path.join(WORKSPACE, "docs", "blank.md"); // no marks

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

  it("keeps a highlight's section, updated without counting as an edit", async () => {
    const section = [{ text: "First", level: 1, occurrence: 0 }];
    const added = await store.addHighlight(PLAIN, highlight({ note: "Hm", section }));
    expect(added.section).toEqual(section);

    const moved = [...section, { text: "Second line", level: 2, occurrence: 1 }];
    const updated = await store.updateHighlight(PLAIN, added.id, { section: moved });
    expect([updated.section, updated.updated, updated.state]).toEqual([moved, added.updated, undefined]);
    // Another change keeps it; an empty one (before the first heading) removes it
    expect((await store.updateHighlight(PLAIN, added.id, { color: "blue" })).section).toEqual(moved);
    expect("section" in (await store.updateHighlight(PLAIN, added.id, { section: [] }))).toBe(false);
    expect(await refusal(() => store.updateHighlight(PLAIN, added.id, { section: [null] }))).toBe(400);
    expect(await refusal(() => store.updateHighlight(PLAIN, added.id, { section: "First" }))).toBe(400);
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

describe("changedOutside", () => {
  it("tells another process's changes from the store's own", async () => {
    const id = recordId(PLAIN);
    // Not changed by this store yet
    expect(await store.changedOutside(id)).toBe(true);

    const added = await store.addHighlight(PLAIN, highlight());
    expect(await store.changedOutside(id)).toBe(false);

    // Another store (the MCP server's) writes the same record
    await new MarksStore(dataDir).updateHighlight(PLAIN, added.id, { note: "From the agent" });
    expect(await store.changedOutside(id)).toBe(true);

    await store.updateHighlight(PLAIN, added.id, { color: "blue" });
    expect(await store.changedOutside(id)).toBe(false);
  });

  it("counts a removed record as the store's own only when it removed it", async () => {
    const doc = path.join(mkdtempSync(path.join(os.tmpdir(), "folio-outside-")), "doc.md");
    writeFileSync(doc, "No headings here.");
    const id = recordId(doc);
    const own = await store.addHighlight(doc, highlight());
    await store.deleteHighlight(doc, own.id);
    expect(existsSync(path.join(dataDir, "marks", `${id}.json`))).toBe(false);
    expect(await store.changedOutside(id)).toBe(false);

    const other = new MarksStore(dataDir);
    const added = await other.addHighlight(doc, highlight());
    expect(await store.changedOutside(id)).toBe(true);
    await store.updateHighlight(doc, added.id, { color: "green" });
    await other.deleteHighlight(doc, added.id);
    expect(await store.changedOutside(id)).toBe(true);
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

  it("keeps the marks of a file that's on another branch where they are", async () => {
    const moved = realPath(at("docs/archive/html-title.md"));
    const renamed = realPath(at("docs/old/front-matter-untitled.md"));
    const onOtherBranches = async (files: readonly string[]) =>
      new Map(files.filter((file) => file === moved || file === renamed).map((file) => [file, "feature/x"]));
    const after = await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP), { onOtherBranches });
    // Not moved by itself, nor suggested a document
    expect(recordOf(at("docs/html-title.md"))).toBeNull();
    expect(after.missing.map((m) => [m.location, m.branch, m.suggestion])).toEqual([
      ["docs/archive/html-title.md", "feature/x", null],
      ["docs/gone.md", undefined, null],
      ["docs/old/front-matter-untitled.md", "feature/x", null],
    ]);
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

describe("sending notes", () => {
  const ROUND = "0123456789abcdef";

  it("sets and clears a highlight's state and privacy", async () => {
    const added = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    expect(added.state).toBeUndefined();
    const locked = await store.updateHighlight(PLAIN, added.id, { private: true });
    expect(locked.private).toBe(true);
    const resolved = await store.updateHighlight(PLAIN, added.id, { state: "resolved", private: null });
    expect([resolved.state, "private" in resolved]).toEqual(["resolved", false]);
    // Open is the default, so it isn't written
    const reopened = await store.updateHighlight(PLAIN, added.id, { state: "open" });
    expect("state" in reopened).toBe(false);
    expect(await refusal(() => store.updateHighlight(PLAIN, added.id, { state: "done" }))).toBe(400);
    expect(await refusal(() => store.updateHighlight(PLAIN, added.id, { private: "yes" }))).toBe(400);
  });

  it("records a round and marks open notes sent", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "One" }));
    const b = await store.addHighlight(PLAIN, highlight({ note: "Two" }));
    await store.updateHighlight(PLAIN, b.id, { state: "addressed" });
    const sent = await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id, b.id, "gone"] });
    // Only the open note changes; an addressed one stays as it is
    expect(sent).toEqual({ highlightIds: [a.id], documentNote: false });
    const record = recordOf(PLAIN) as { highlights: Highlight[]; rounds: { id: string; via: string; notes: string[]; sha1: string }[] };
    const states = (r: { highlights: Highlight[] }) => [a.id, b.id].map((id) => r.highlights.find((h) => h.id === id)?.state);
    expect(states(record)).toEqual(["sent", "addressed"]);
    expect(record.rounds).toHaveLength(1);
    expect([record.rounds[0]?.id, record.rounds[0]?.via, record.rounds[0]?.notes]).toEqual([ROUND, "copy", [a.id, b.id]]);
    expect(record.rounds[0]?.sha1).toBe((await fingerprint(PLAIN)).sha1);

    await store.unsend(PLAIN, { roundId: ROUND, ...sent });
    const undone = recordOf(PLAIN) as { highlights: Highlight[]; rounds?: unknown };
    expect(states(undone)).toEqual([undefined, "addressed"]);
    expect(undone.rounds).toBeUndefined();
  });

  it("marks rounds picked up once, when the agent takes them", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "One" }));
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id], via: "send", client: "Claude Code" });
    const round = () => (recordOf(PLAIN) as { rounds: { picked?: string }[] }).rounds[0];
    expect(round()?.picked).toBeUndefined();
    await store.markPicked(PLAIN, [ROUND, "fedcba9876543210"]);
    const picked = round()?.picked;
    expect(Number.isNaN(Date.parse(picked ?? ""))).toBe(false);
    // Taken again (another session): the first time stays
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.markPicked(PLAIN, [ROUND]);
    expect(round()?.picked).toBe(picked);
  });

  it("records a round without changing states when asked", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "One" }));
    const sent = await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id], markSent: false });
    expect(sent.highlightIds).toEqual([]);
    expect((recordOf(PLAIN) as { highlights: Highlight[] }).highlights.find((h) => h.id === a.id)?.state).toBeUndefined();
    expect((recordOf(PLAIN) as { rounds: unknown[] }).rounds).toHaveLength(1);
  });

  it("keeps the latest five rounds", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "One" }));
    for (let i = 0; i < 7; i++) {
      await store.send(PLAIN, { roundId: `${i}`.padStart(16, "0"), highlightIds: [a.id] });
    }
    const rounds = (recordOf(PLAIN) as { rounds: { id: string }[] }).rounds;
    expect(rounds.map((r) => r.id.slice(-1))).toEqual(["2", "3", "4", "5", "6"]);
  });

  it("sends the document's note, keeps its state over a lock and opens it again when edited", async () => {
    await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null });
    const sent = await store.send(BLANK_DOC, { roundId: ROUND, highlightIds: [], documentNote: true });
    expect(sent.documentNote).toBe(true);
    const locked = await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null, private: true });
    expect([locked?.state, locked?.private]).toEqual(["sent", true]);
    const unlocked = await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null, private: null });
    expect(unlocked?.state).toBe("sent");
    const listing = await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP));
    const listed = listing.documents.find((d) => d.docId === stableId("docs/blank.md"));
    expect([listed?.note?.state, listed?.rounds?.length]).toEqual(["sent", 1]);

    // New wording, or a new status asked for, goes with the next round
    const edited = await store.setNote(BLANK_DOC, { text: "Overall fine, mostly.", requestedStatus: null });
    expect(edited !== null && "state" in edited).toBe(false);
    await store.send(BLANK_DOC, { roundId: "fedcba9876543210", highlightIds: [], documentNote: true });
    const asked = await store.setNote(BLANK_DOC, { text: "Overall fine, mostly.", requestedStatus: "accepted" });
    expect(asked !== null && "state" in asked).toBe(false);
  });

  it("opens a sent highlight's note again when its wording changes", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id] });
    // A colour or the same text isn't new feedback
    expect((await store.updateHighlight(PLAIN, a.id, { color: "green" })).state).toBe("sent");
    expect((await store.updateHighlight(PLAIN, a.id, { note: "Why?" })).state).toBe("sent");
    const edited = await store.updateHighlight(PLAIN, a.id, { note: "Why 100?" });
    expect([edited.note, "state" in edited]).toEqual(["Why 100?", false]);
    // A state asked for with the edit wins
    expect((await store.updateHighlight(PLAIN, a.id, { note: "Why 200?", state: "resolved" })).state).toBe("resolved");
  });

  it("remembers the state a note was resolved from", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    await store.updateHighlight(PLAIN, a.id, { state: "addressed" });
    const resolved = await store.updateHighlight(PLAIN, a.id, { state: "resolved" });
    expect([resolved.state, resolved.resolvedFrom]).toEqual(["resolved", "addressed"]);
    // Resolved again from open: nothing to go back to but open
    await store.updateHighlight(PLAIN, a.id, { state: "open" });
    const again = await store.updateHighlight(PLAIN, a.id, { state: "resolved" });
    expect([again.state, "resolvedFrom" in again]).toEqual(["resolved", false]);

    await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null });
    await store.send(BLANK_DOC, { roundId: ROUND, highlightIds: [], documentNote: true });
    const note = await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null, state: "resolved" });
    expect(note?.resolvedFrom).toBe("sent");
    const listing = await listMarks(store, WORKSPACE, await scanWorkspace(WORKSPACE, SKIP));
    expect(listing.documents.find((d) => d.docId === stableId("docs/blank.md"))?.note?.resolvedFrom).toBe("sent");
  });

  it("refuses a malformed send", async () => {
    await store.addHighlight(PLAIN, highlight({ note: "One" }));
    expect(await refusal(() => store.send(PLAIN, { roundId: "x", highlightIds: [] }))).toBe(400);
    expect(await refusal(() => store.send(PLAIN, { roundId: ROUND, highlightIds: [1] }))).toBe(400);
    expect(await refusal(() => store.send(path.join(WORKSPACE, "docs", "blank.md"), { roundId: ROUND }))).toBe(404);
  });
});

describe("threads", () => {
  const ROUND = "0123456789abcdef";
  const CLAUDE = { kind: "agent", name: "Claude Code" };

  it("records a round fetched by an agent", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "One" }));
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id], via: "mcp", client: "Claude Code" });
    const round = (recordOf(PLAIN) as { rounds: Record<string, unknown>[] }).rounds[0];
    expect([round?.["via"], round?.["client"]]).toEqual(["mcp", "Claude Code"]);
    expect(await refusal(() => store.send(PLAIN, { roundId: ROUND, via: "email" }))).toBe(400);
  });

  it("adds replies and moves the note through its states", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id] });

    const done = await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Reworded.", addressed: true });
    expect(done.state).toBe("addressed");
    expect(done.replies?.map((r) => [r.author, r.text])).toEqual([[CLAUDE, "Reworded."]]);
    expect(done.replies?.[0]?.id).toHaveLength(16);

    // The user disagrees: open again, to go with the next round
    await store.updateHighlight(PLAIN, a.id, { state: "resolved" });
    const answered = await store.reply(PLAIN, a.id, { author: { kind: "user" }, text: "Not quite." });
    expect(["state" in answered, answered.replies?.length]).toEqual([false, 2]);

    // A question from the agent keeps the note sent: answered, it doesn't go again
    await store.send(PLAIN, { roundId: "fedcba9876543210", highlightIds: [a.id] });
    const asked = await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Which section?" });
    expect(asked.state).toBe("sent");
    expect((recordOf(PLAIN) as { highlights: Highlight[] }).highlights.find((h) => h.id === a.id)?.replies).toHaveLength(3);
  });

  it("keeps the agent's passage until the viewer takes it as the quote", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Reword this" }));
    const replied = await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Reworded.", addressed: true, passage: "New words" });
    expect(replied.passage).toEqual({ exact: "New words", at: replied.replies?.[0]?.at });

    const replacement = { quote: { exact: "New words", prefix: "a ", suffix: " b" }, position: { start: 5, end: 14 } };
    const taken = await store.updateHighlight(PLAIN, a.id, { replacement });
    expect([taken.quote, taken.position, taken.replaced?.exact, "passage" in taken]).toEqual([
      replacement.quote,
      replacement.position,
      a.quote.exact,
      false,
    ]);
    expect(taken.updated).toBe(replied.updated);
    // Taken already (another window): nothing changes
    const again = await store.updateHighlight(PLAIN, a.id, { replacement: { ...replacement, position: { start: 50, end: 59 } } });
    expect(again.position).toEqual(replacement.position);

    expect(await refusal(() => store.reply(PLAIN, a.id, { author: CLAUDE, text: "x", passage: " " }))).toBe(400);
    await store.setNote(BLANK_DOC, { text: "Overall", requestedStatus: null });
    expect(await refusal(() => store.reply(BLANK_DOC, null, { author: CLAUDE, text: "x", passage: "y" }))).toBe(400);
  });

  it("replies to the document's note", async () => {
    await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: "accepted" });
    const note = await store.reply(BLANK_DOC, null, { author: CLAUDE, text: "Status changed.", addressed: true });
    expect([note.state, note.replies?.length]).toEqual(["addressed", 1]);
    // An edit keeps the thread
    const edited = await store.setNote(BLANK_DOC, { text: "Overall fine, mostly.", requestedStatus: "accepted" });
    expect(edited?.replies?.[0]?.text).toBe("Status changed.");
    expect(await refusal(() => store.reply(PLAIN, null, { author: CLAUDE, text: "Hi" }))).toBe(404);
  });

  it("edits the user's latest reply until someone answers it", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    const asked = await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Which part?" });
    // Copied without marking it sent: the agent's answer shows it has the note
    expect(asked.state).toBe("sent");
    const answered = await store.reply(PLAIN, a.id, { author: { kind: "user" }, text: "The frist one." });
    const mine = answered.replies?.[1]?.id ?? "";
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id] });

    // Sent before the edit: open again, so the new wording goes next round
    const edited = await store.editReply(PLAIN, a.id, mine, { text: "The first one." });
    expect(edited.replies?.map((r) => r.text)).toEqual(["Which part?", "The first one."]);
    expect(edited.replies?.[1]?.id).toBe(mine);
    expect("state" in edited).toBe(false);

    // The agent's reply isn't the user's to edit, and an answered one stays
    expect(await refusal(() => store.editReply(PLAIN, a.id, asked.replies?.[0]?.id ?? "", { text: "No" }))).toBe(409);
    await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Done.", addressed: true });
    expect(await refusal(() => store.editReply(PLAIN, a.id, mine, { text: "Both." }))).toBe(409);
    expect(await refusal(() => store.editReply(PLAIN, a.id, "gone", { text: "Both." }))).toBe(404);
    expect(await refusal(() => store.editReply(PLAIN, a.id, mine, { text: " " }))).toBe(400);
  });

  it("deletes the user's latest reply before it's sent, back to the note's state", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    await store.reply(PLAIN, a.id, { author: CLAUDE, text: "Reworded.", addressed: true });
    const answered = await store.reply(PLAIN, a.id, { author: { kind: "user" }, text: "Not quite." });
    const mine = answered.replies?.[1]?.id ?? "";
    expect([answered.state, answered.replies?.[1]?.reopened]).toEqual([undefined, "addressed"]);

    const back = await store.deleteReply(PLAIN, a.id, mine);
    expect([back.state, back.replies?.map((r) => r.text)]).toEqual(["addressed", ["Reworded."]]);

    // Back to resolved: it still goes back to addressed when unresolved
    await store.updateHighlight(PLAIN, a.id, { state: "resolved" });
    const reopened = await store.reply(PLAIN, a.id, { author: { kind: "user" }, text: "One more thing." });
    const resolved = await store.deleteReply(PLAIN, a.id, reopened.replies?.[1]?.id ?? "");
    expect([resolved.state, resolved.resolvedFrom]).toEqual(["resolved", "addressed"]);
    // The agent's reply isn't the user's to delete
    expect(await refusal(() => store.deleteReply(PLAIN, a.id, back.replies?.[0]?.id ?? ""))).toBe(409);

    // Sent: the agent may have it, so it stays
    const again = await store.reply(PLAIN, a.id, { author: { kind: "user" }, text: "Not quite." });
    await store.send(PLAIN, { roundId: ROUND, highlightIds: [a.id] });
    expect(await refusal(() => store.deleteReply(PLAIN, a.id, again.replies?.[1]?.id ?? ""))).toBe(409);
    expect(await refusal(() => store.deleteReply(PLAIN, a.id, "gone"))).toBe(404);
  });

  it("deletes the only reply to the document's note", async () => {
    await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null });
    const note = await store.reply(BLANK_DOC, null, { author: { kind: "user" }, text: "Also the title." });
    const back = await store.deleteReply(BLANK_DOC, null, note.replies?.[0]?.id ?? "");
    expect(["replies" in back, "state" in back]).toEqual([false, false]);
  });

  it("edits the user's reply to the document's note", async () => {
    await store.setNote(BLANK_DOC, { text: "Overall fine.", requestedStatus: null });
    const note = await store.reply(BLANK_DOC, null, { author: { kind: "user" }, text: "Also the title." });
    const edited = await store.editReply(BLANK_DOC, null, note.replies?.[0]?.id ?? "", { text: "Also the intro." });
    expect(edited.replies?.[0]?.text).toBe("Also the intro.");
  });

  it("marks a thread seen without changing the note", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    await store.markSeen(PLAIN, a.id);
    const saved = (recordOf(PLAIN) as { highlights: Highlight[] }).highlights.find((h) => h.id === a.id);
    expect(typeof saved?.seen).toBe("string");
    expect(saved?.updated).toBe(a.updated);
    expect(await refusal(() => store.markSeen(PLAIN, "gone"))).toBe(404);
  });

  it("records the status the document had when its note was seen", async () => {
    const note = await store.setNote(BLANK_DOC, { text: null, requestedStatus: "accepted" });
    await store.markSeen(BLANK_DOC, null, "accepted");
    const saved = recordOf(BLANK_DOC) as { documentNote: DocumentNote };
    expect(saved.documentNote.statusSeen).toBe("accepted");
    expect(saved.documentNote.updated).toBe(note?.updated);
    await store.markSeen(BLANK_DOC, null);
    expect("statusSeen" in (recordOf(BLANK_DOC) as { documentNote: DocumentNote }).documentNote).toBe(false);
  });

  it("refuses a malformed reply", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    expect(await refusal(() => store.reply(PLAIN, a.id, { author: CLAUDE, text: "  " }))).toBe(400);
    expect(await refusal(() => store.reply(PLAIN, a.id, { author: { kind: "agent" }, text: "Hi" }))).toBe(400);
    expect(await refusal(() => store.reply(PLAIN, a.id, { author: { kind: "bot" }, text: "Hi" }))).toBe(400);
    expect(await refusal(() => store.reply(PLAIN, a.id, { author: CLAUDE, text: "x".repeat(10_001) }))).toBe(400);
    expect(await refusal(() => store.reply(PLAIN, "gone", { author: CLAUDE, text: "Hi" }))).toBe(404);
  });

  it("allows at most 100 replies to a note", async () => {
    const a = await store.addHighlight(PLAIN, highlight({ note: "Why?" }));
    for (let i = 0; i < 100; i++) await store.reply(PLAIN, a.id, { author: CLAUDE, text: `${i}` });
    expect(await refusal(() => store.reply(PLAIN, a.id, { author: CLAUDE, text: "One more" }))).toBe(409);
  });
});
