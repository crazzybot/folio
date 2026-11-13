import { describe, expect, it } from "vitest";
import { DemoMarks, STORAGE_KEY, type MarksStorage, type StoredMarks } from "./marks";
import type { Highlight } from "../types";

const listed = [
  { id: "a", location: "docs/a.md" },
  { id: "b", location: "docs/b.md" },
];

const anchor = { quote: { exact: "two", prefix: "one ", suffix: " three" }, position: { start: 4, end: 7 } };

function seedHighlight(id: string): Highlight {
  return { id, color: "yellow", note: "Seed", ...anchor, created: "2026-11-01T00:00:00Z", updated: "2026-11-01T00:00:00Z" };
}

const seed: Record<string, StoredMarks> = { b: { bookmarks: [], highlights: [seedHighlight("s1")] } };

/** A Map-backed Storage; `failWrites` makes setItem throw, as a full or blocked one does. */
function memoryStorage(failWrites = false): MarksStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => void data.delete(key),
  };
}

describe("DemoMarks", () => {
  it("starts from the seed marks, without saving them", () => {
    const storage = memoryStorage();
    const marks = new DemoMarks(listed, seed, storage);
    expect(marks.list()).toEqual({
      documents: [{ docId: "b", location: "docs/b.md", bookmarks: [], highlights: [seedHighlight("s1")] }],
      missing: [],
    });
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
  });

  it("adds a highlight, saves it and lists documents in list order", () => {
    const storage = memoryStorage();
    const marks = new DemoMarks(listed, seed, storage);
    const added = marks.addHighlight("a", { ...anchor, color: "green", note: "Why?" });
    expect(added).toMatchObject({ color: "green", note: "Why?", ...anchor });
    expect(added.id).toMatch(/^[0-9a-f]{16}$/);
    expect(added.created).toBe(added.updated);
    expect(marks.list().documents.map((d) => d.docId)).toEqual(["a", "b"]);

    // Another visit to the page reads what was saved
    const again = new DemoMarks(listed, seed, storage);
    expect(again.list()).toEqual(marks.list());
  });

  it("changes a highlight's colour and note; a blank note removes it", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    expect(marks.updateHighlight("b", "s1", { color: "pink" })).toMatchObject({ color: "pink", note: "Seed" });
    expect(marks.updateHighlight("b", "s1", { note: "  " }).note).toBeNull();
    expect(marks.updateHighlight("b", "s1", { note: "Again" }).note).toBe("Again");
    expect(marks.addHighlight("a", { ...anchor, color: "blue", note: "" }).note).toBeNull();
  });

  it("removes a highlight, and a document with no marks left", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    marks.deleteHighlight("b", "s1");
    expect(marks.list().documents).toEqual([]);
  });

  it("refuses to change a highlight it doesn't have", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    expect(() => marks.updateHighlight("b", "nope", { color: "blue" })).toThrow("not found");
    expect(() => marks.deleteHighlight("a", "s1")).toThrow("not found");
  });

  it("bookmarks a document or a heading once, and removes bookmarks", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    const heading = { text: "Storage", level: 2, occurrence: 0 };
    const first = marks.addBookmark("a", heading);
    expect(marks.addBookmark("a", { ...heading })).toEqual(first);
    expect(marks.addBookmark("a", { ...heading, occurrence: 1 }).id).not.toBe(first.id);
    const whole = marks.addBookmark("a", null);
    expect(whole.heading).toBeNull();
    expect(marks.list().documents[0]?.bookmarks).toHaveLength(3);

    marks.deleteBookmark("a", first.id);
    expect(marks.list().documents[0]?.bookmarks.map((b) => b.id)).not.toContain(first.id);
    expect(() => marks.deleteBookmark("a", first.id)).toThrow("not found");
  });

  it("hands out copies, so callers can't change what's stored", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    const listedMarks = marks.list();
    const highlight = listedMarks.documents[0]?.highlights[0];
    if (highlight) highlight.note = "changed";
    expect(marks.list().documents[0]?.highlights[0]?.note).toBe("Seed");
  });

  it("goes back to the seed marks on reset", () => {
    const storage = memoryStorage();
    const marks = new DemoMarks(listed, seed, storage);
    marks.deleteHighlight("b", "s1");
    marks.addBookmark("a", null);
    marks.reset();
    expect(marks.list().documents.map((d) => d.docId)).toEqual(["b"]);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(new DemoMarks(listed, seed, storage).list()).toEqual(marks.list());
  });

  it("starts from the seed when what's saved is damaged or from another version", () => {
    const storage = memoryStorage();
    storage.data.set(STORAGE_KEY, "{not json");
    expect(new DemoMarks(listed, seed, storage).list().documents.map((d) => d.docId)).toEqual(["b"]);
    storage.data.set(STORAGE_KEY, JSON.stringify({ version: 99, documents: {} }));
    expect(new DemoMarks(listed, seed, storage).list().documents.map((d) => d.docId)).toEqual(["b"]);
  });

  it("keeps working in memory when storage refuses writes", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage(true));
    marks.addBookmark("a", null);
    expect(marks.list().documents.map((d) => d.docId)).toEqual(["a", "b"]);
  });

  it("keeps working with no storage at all", () => {
    const marks = new DemoMarks(listed, seed, null);
    marks.addHighlight("a", { ...anchor, color: "yellow", note: null });
    marks.reset();
    expect(marks.list().documents.map((d) => d.docId)).toEqual(["b"]);
  });

  it("sets, updates and removes a document note", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    const note = marks.setNote("a", { text: "Fine.", requestedStatus: " accepted " });
    expect([note?.text, note?.requestedStatus]).toEqual(["Fine.", "accepted"]);
    expect(marks.list().documents.find((d) => d.docId === "a")).toMatchObject({ note, bookmarks: [], highlights: [] });

    const updated = marks.setNote("a", { text: null, requestedStatus: "rejected" });
    expect([updated?.text, updated?.created]).toEqual([null, note?.created]);

    // Nothing left: the document drops out of the listing
    expect(marks.setNote("a", { text: " ", requestedStatus: null })).toBeNull();
    expect(marks.list().documents.map((d) => d.docId)).toEqual(["b"]);
    expect(() => marks.deleteNote("a")).toThrow();
  });

  it("records a round, makes open notes sent and undoes it", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    const round = marks.send([{ docId: "b", highlightIds: ["s1"], documentNote: false }], true);
    expect(round.documents).toEqual([{ docId: "b", highlightIds: ["s1"], documentNote: false }]);
    const sent = marks.list().documents[0];
    expect([sent?.highlights[0]?.state, sent?.rounds?.[0]?.notes]).toEqual(["sent", ["s1"]]);

    marks.unsend(round);
    const undone = marks.list().documents[0];
    expect([undone?.highlights[0]?.state, undone?.rounds]).toEqual([undefined, undefined]);
  });

  it("locks and unlocks a note", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    expect(marks.updateHighlight("b", "s1", { private: true }).private).toBe(true);
    expect("private" in marks.updateHighlight("b", "s1", { private: null })).toBe(false);
  });

  it("adds the visitor's replies, reopening the note, and records that a thread was seen", () => {
    const marks = new DemoMarks(listed, seed, memoryStorage());
    marks.updateHighlight("b", "s1", { state: "addressed" });
    const replied = marks.reply("b", "s1", "Not quite.");
    expect([replied.state, replied.replies?.map((r) => [r.author, r.text])]).toEqual([undefined, [[{ kind: "user" }, "Not quite."]]]);
    marks.markSeen("b", "s1");
    expect(typeof marks.list().documents[0]?.highlights[0]?.seen).toBe("string");
    expect(() => marks.reply("b", "s1", "  ")).toThrow();
    expect(() => marks.reply("a", null, "Hi")).toThrow();
  });
});
