import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  feedbackSummary,
  filterOf,
  highlightKey,
  isPrivate,
  noteKey,
  picked,
  sendableNote,
  sendDocuments,
  sendGroups,
  shownStates,
} from "./sending";
import type { DocumentMeta, DocumentNote, Highlight } from "./types";

const doc = (location: string, status: string | null = null): DocumentMeta => ({
  id: location,
  filename: location,
  location,
  title: location,
  created: "",
  headings: [],
  ...(status === null ? {} : { meta: { status, statusDetail: null, date: null, people: [], tags: [], statusLine: 3 } }),
});

const highlight = (id: string, start: number, note: string | null, extra: Partial<Highlight> = {}): Highlight => ({
  id,
  color: "yellow",
  note,
  quote: { exact: id, prefix: "", suffix: "" },
  position: { start, end: start + 1 },
  created: "",
  updated: "",
  ...extra,
});

const docNote = (extra: Partial<DocumentNote> = {}): DocumentNote => ({
  text: "Overall",
  requestedStatus: null,
  created: "",
  updated: "",
  ...extra,
});

describe("privacy", () => {
  it("makes highlights without a note private unless sent to the agent", () => {
    expect(isPrivate(highlight("a", 0, null))).toBe(true);
    expect(isPrivate(highlight("a", 0, "  "))).toBe(true);
    expect(isPrivate(highlight("a", 0, null, { private: false }))).toBe(false);
    expect(isPrivate(highlight("a", 0, "Why?"))).toBe(false);
    expect(isPrivate(highlight("a", 0, "Why?", { private: true }))).toBe(true);
  });

  it("keeps a locked document note's status change as feedback", () => {
    expect(sendableNote(docNote({ private: true }), null)).toBeNull();
    const request = sendableNote(docNote({ private: true, requestedStatus: "accepted" }), "proposed");
    expect([request?.text, request?.requestedStatus]).toEqual([null, "accepted"]);
    // A status the document already has isn't sent
    expect(sendableNote(docNote({ text: null, requestedStatus: "accepted" }), "accepted")).toBeNull();
  });

  it("files marks under the state filter", () => {
    expect(filterOf(highlight("a", 0, null))).toBe("private");
    expect(filterOf(highlight("a", 0, "Why?", { state: "sent" }))).toBe("sent");
    expect(filterOf(highlight("a", 0, "Why?"))).toBe("open");
  });
});

describe("shownStates", () => {
  it("shows all but resolved notes until states are picked, then only those", () => {
    expect([...shownStates(new Set())].sort()).toEqual(["addressed", "open", "private", "sent"]);
    expect([...shownStates(new Set(["resolved"]))]).toEqual(["resolved"]);
  });
});

describe("feedbackSummary", () => {
  it("counts feedback by state, leaving private marks out", () => {
    const highlights = [
      highlight("a", 0, "One"),
      highlight("b", 1, "Two"),
      highlight("c", 2, "Three", { state: "sent" }),
      highlight("d", 3, "Four", { state: "addressed" }),
      highlight("e", 4, null),
      highlight("f", 5, "Mine", { private: true }),
    ];
    expect(feedbackSummary(highlights, docNote(), null)).toBe("3 unsent · 1 sent · 1 addressed");
    expect(feedbackSummary([highlight("e", 4, null)], undefined, null)).toBe("");
  });
});

describe("the Send dialog", () => {
  const adr = doc("adr.md", "proposed");
  const guide = doc("guide.md");
  const groups = sendGroups([
    {
      doc: adr,
      source: "",
      note: docNote({ requestedStatus: "accepted" }),
      highlights: [
        highlight("late", 9, "Second"),
        highlight("early", 1, "First"),
        highlight("bare", 2, null),
        highlight("sent", 3, "Again?", { state: "sent" }),
        highlight("done", 4, "Fixed", { state: "addressed" }),
        highlight("gone", 5, "Moved"),
      ],
      unplaced: new Set(["gone"]),
    },
    { doc: guide, source: "", highlights: [highlight("mine", 0, "Ask Dana", { private: true })] },
    { doc: doc("empty.md"), source: "", highlights: [] },
  ]);

  it("lists open notes, offers sent ones apart and counts the rest", () => {
    expect(groups.map((g) => g.doc.id)).toEqual(["adr.md", "guide.md"]);
    const [first, second] = groups;
    expect(first?.items.map((i) => i.key)).toEqual([noteKey("adr.md"), highlightKey("adr.md", "early"), highlightKey("adr.md", "late")]);
    expect(first?.sentBefore.map((i) => i.highlight?.id)).toEqual(["sent"]);
    expect([first?.privateCount, first?.unplacedCount]).toEqual([1, 1]);
    expect([second?.items.length, second?.privateCount]).toEqual([0, 1]);
  });

  it("ticks open notes and sends what's ticked", () => {
    const selected = defaultSelection(groups);
    expect(selected.size).toBe(3);
    selected.delete(highlightKey("adr.md", "late"));
    selected.add(highlightKey("adr.md", "sent"));
    const picks = picked(groups, selected);
    expect(picks.map((p) => p.highlights.map((h) => h.id))).toEqual([["early", "sent"]]);
    expect(picks[0]?.note?.requestedStatus).toBe("accepted");
    expect(sendDocuments(picks)).toEqual([{ docId: "adr.md", highlightIds: ["early", "sent"], documentNote: true }]);
  });
});
