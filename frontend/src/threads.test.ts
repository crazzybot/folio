import { describe, expect, it } from "vitest";
import { canReply, newReplies, newsOf, repliedNotes, repliesParts, repliesSummary, replyTime, threadSummary } from "./threads";
import type { NoteKind, Reply, Thread } from "./types";

const claude = (text: string, at: string): Reply => ({ id: text, author: { kind: "agent", name: "Claude Code" }, text, at });
const mine = (text: string, at: string): Reply => ({ id: text, author: { kind: "user" }, text, at });

describe("canReply", () => {
  it("is for an answer: someone else spoke last", () => {
    expect(canReply({})).toBe(false);
    expect(canReply({ replies: [claude("a", "2026-11-12T10:00:00Z")] })).toBe(true);
    expect(canReply({ replies: [claude("a", "2026-11-12T10:00:00Z"), mine("b", "2026-11-12T10:05:00Z")] })).toBe(false);
    // An imported comment is someone else's note
    expect(canReply({ author: { kind: "github", login: "octocat" } })).toBe(true);
  });
});

describe("newReplies", () => {
  it("counts others' replies after the thread was last seen", () => {
    const thread: Thread = { replies: [claude("a", "2026-11-12T10:00:00Z"), mine("b", "2026-11-12T10:05:00Z"), claude("c", "2026-11-12T10:10:00Z")] };
    expect(newReplies(thread).map((r) => r.text)).toEqual(["a", "c"]);
    expect(newReplies({ ...thread, seen: "2026-11-12T10:06:00Z" }).map((r) => r.text)).toEqual(["c"]);
    expect(newReplies({})).toEqual([]);
  });
});

describe("newReplies across time formats", () => {
  it("compares times, not text: seen with milliseconds in the reply's second", () => {
    const reply = claude("x", "2026-11-24T19:00:35Z");
    expect(newReplies({ replies: [reply], seen: "2026-11-24T19:00:35.412Z" })).toEqual([]);
    expect(newReplies({ replies: [reply], seen: "2026-11-24T19:00:34.999Z" })).toEqual([reply]);
  });
});

describe("repliedNotes and repliesSummary", () => {
  const byDoc: [string, { highlights: (Thread & { id: string })[]; note?: Thread }][] = [
    ["a", { highlights: [{ id: "h1", replies: [claude("x", "2026-11-12T10:00:00Z")] }, { id: "h2" }], note: { replies: [claude("y", "2026-11-12T10:00:00Z")] } }],
    ["b", { highlights: [{ id: "h3", replies: [{ id: "z", author: { kind: "agent", name: "Codex" }, text: "z", at: "2026-11-12T10:00:00Z" }] }] }],
  ];

  it("lists the notes with new replies, the document's note first", () => {
    expect(repliedNotes(byDoc)).toEqual([
      { docId: "a", highlightId: null, authors: ["Claude Code"] },
      { docId: "a", highlightId: "h1", authors: ["Claude Code"] },
      { docId: "b", highlightId: "h3", authors: ["Codex"] },
    ]);
  });

  it("says who replied to how many", () => {
    const notes = repliedNotes(byDoc);
    expect(repliesSummary(notes.slice(0, 2))).toBe("Claude Code replied to 2 notes");
    expect(repliesSummary(notes.slice(2))).toBe("Codex replied to a note");
    expect(repliesSummary(notes)).toBe("Claude Code and Codex replied to 3 notes");
    expect(repliesSummary([])).toBeNull();
  });

  it("splits who from the notes, for the status bar's pill", () => {
    const notes = repliedNotes(byDoc);
    expect(repliesParts(notes)).toEqual({ who: "Claude Code and Codex", did: "replied to", notes: "3 notes" });
    expect(repliesParts(notes.slice(2))).toEqual({ who: "Codex", did: "replied to", notes: "a note" });
    expect(repliesParts([])).toBeNull();
  });

  it("counts the agent's own notes as questions until they're opened", () => {
    const author = { kind: "agent" as const, name: "Claude Code" };
    const asked: [string, { highlights: (Thread & { id: string; kind?: NoteKind })[] }][] = [
      ["a", { highlights: [{ id: "q1", author, kind: "question" as const }, { id: "q2", author, kind: "decision" as const, seen: "2026-11-12T10:00:00Z" }] }],
      ["b", { highlights: [{ id: "q3", author, kind: "comment" as const }] }],
    ];
    const notes = repliedNotes(asked);
    expect(notes).toEqual([
      { docId: "a", highlightId: "q1", authors: ["Claude Code"], asked: true },
      { docId: "b", highlightId: "q3", authors: ["Claude Code"], asked: true },
    ]);
    expect(repliesSummary(notes)).toBe("Claude Code asked 2 questions");
    expect(repliesSummary([...notes, ...repliedNotes(byDoc).slice(0, 1)])).toBe("Claude Code wrote on 3 notes");
    expect([newsOf({ author, kind: "question" }), newsOf({ author, kind: "question", replies: [claude("x", "t")] })]).toEqual([
      "a new question",
      "a new question, a reply",
    ]);
  });
});

describe("replyTime", () => {
  it("is relative for the last hour", () => {
    const now = new Date("2026-11-12T10:30:00Z");
    expect(replyTime("2026-11-12T10:29:30Z", now)).toBe("just now");
    expect(replyTime("2026-11-12T10:25:00Z", now)).toBe("5 min ago");
  });
});

describe("threadSummary", () => {
  const now = new Date("2026-11-12T10:30:00Z");
  // The clock time as the user's locale writes it
  const clock = (at: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));

  it("is null without replies", () => {
    expect(threadSummary({}, now)).toBeNull();
    expect(threadSummary({ replies: [] }, now)).toBeNull();
  });

  it("names the only reply's author and time, never a relative time", () => {
    const summary = threadSummary({ replies: [claude("a", "2026-11-12T10:29:00Z")] }, now);
    expect(summary?.text).toBe(`1 reply from Claude Code, ${clock("2026-11-12T10:29:00Z")}`);
    expect(summary?.fresh).toBe(1);
  });

  it("counts the replies and names the latest's author, with how many are new", () => {
    const thread: Thread = {
      replies: [claude("a", "2026-11-12T10:00:00Z"), mine("b", "2026-11-12T10:05:00Z")],
      seen: "2026-11-12T10:01:00Z",
    };
    const summary = threadSummary(thread, now);
    expect(summary?.text).toBe(`2 replies · latest from You, ${clock("2026-11-12T10:05:00Z")}`);
    expect(summary?.fresh).toBe(0);
  });
});
