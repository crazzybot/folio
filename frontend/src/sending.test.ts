import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  feedbackSummary,
  filterOf,
  highlightKey,
  isPrivate,
  loopKind,
  noteKey,
  picked,
  pickedUpBy,
  loopSentence,
  needsYou,
  sendableNote,
  sendDocuments,
  sendGroups,
  shownStates,
  unplacedFirst,
} from "./sending";
import type { DocumentMeta, DocumentNote, Highlight, Round } from "./types";

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

const agentReply = { id: "r", author: { kind: "agent" as const, name: "Claude Code" }, text: "Why not?", at: "" };
const userReply = { id: "u", author: { kind: "user" as const }, text: "Because.", at: "" };

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

describe("unplacedFirst", () => {
  it("shows notes still in the loop, and any with new replies", () => {
    expect(unplacedFirst(highlight("a", 0, "Cut this"))).toBe(true);
    expect(unplacedFirst(highlight("a", 0, "Cut this", { state: "addressed" }))).toBe(true);
    expect(unplacedFirst(highlight("a", 0, "Mine", { private: true }))).toBe(true);
    expect(unplacedFirst(highlight("a", 0, null, { private: false }))).toBe(true);
    const reply = { id: "r", author: { kind: "agent" as const, name: "Claude Code" }, text: "Removed it", at: "2026-11-15T10:00:00Z" };
    expect(unplacedFirst(highlight("a", 0, "Cut this", { state: "resolved", replies: [reply] }))).toBe(true);
  });

  it("keeps resolved notes and bare highlights for later", () => {
    expect(unplacedFirst(highlight("a", 0, null))).toBe(false);
    expect(unplacedFirst(highlight("a", 0, "Cut this", { state: "resolved" }))).toBe(false);
    const seen = { id: "r", author: { kind: "agent" as const, name: "Claude Code" }, text: "Removed it", at: "2026-11-15T10:00:00Z" };
    expect(unplacedFirst(highlight("a", 0, "Cut this", { state: "resolved", replies: [seen], seen: "2026-11-15T11:00:00Z" }))).toBe(false);
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
      highlight("g", 6, "Five", { state: "sent", replies: [agentReply] }),
    ];
    expect(feedbackSummary(highlights, docNote(), null)).toBe("3 unsent · 1 sent · 1 answered · 1 addressed");
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

describe("pickedUpBy", () => {
  const round = (id: string, extra: Partial<Round>): Round => ({ id, at: "2026-11-14T10:00:00Z", via: "send", sha1: "", notes: ["h1"], ...extra });

  it("names the agent that took the round that last sent the note", () => {
    expect(pickedUpBy([round("r1", { client: "Claude Code" })], "h1")).toBeNull();
    expect(pickedUpBy([round("r1", { client: "Claude Code", picked: "2026-11-14T10:00:01Z" })], "h1")).toBe("Claude Code");
    // The agent's own fetch is picked up as it's recorded; a copy never is
    expect(pickedUpBy([round("r1", { via: "mcp", client: "Cursor" })], "h1")).toBe("Cursor");
    expect(pickedUpBy([round("r1", { via: "copy" })], "h1")).toBeNull();
    // Sent again since: the new round decides
    expect(pickedUpBy([round("r1", { client: "Claude Code", picked: "x" }), round("r2", { client: "Claude Code" })], "h1")).toBeNull();
  });

  it("says so in the note's loop sentence", () => {
    expect(loopSentence("sent", null, "Claude Code")).toBe("Sent · Claude Code is working on it");
    expect(loopSentence("sent")).toBe("Sent · waiting for the agent");
  });
});

describe("answered notes", () => {
  it("are sent notes whose latest reply is the agent's", () => {
    expect(loopKind(highlight("a", 0, "Why?", { state: "sent", replies: [agentReply] }))).toBe("answered");
    expect(loopKind(highlight("a", 0, "Why?", { state: "sent", replies: [agentReply, userReply] }))).toBe("sent");
    expect(loopKind(highlight("a", 0, "Why?", { state: "sent" }))).toBe("sent");
    expect(loopKind(highlight("a", 0, "Why?", { state: "addressed", replies: [agentReply] }))).toBe("addressed");
    expect(loopKind(docNote({ state: "sent", replies: [agentReply] }))).toBe("answered");
  });

  it("wait on the user", () => {
    expect(needsYou("answered")).toBe(true);
    expect(loopSentence("answered", null, "Claude Code")).toBe("Answered by Claude Code · reply or resolve it");
  });
});
