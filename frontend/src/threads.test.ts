import { describe, expect, it } from "vitest";
import { newReplies, repliedNotes, repliesSummary, replyTime, threadSummary } from "./threads";
import type { Reply, Thread } from "./types";

const claude = (text: string, at: string): Reply => ({ id: text, author: { kind: "agent", name: "Claude Code" }, text, at });
const mine = (text: string, at: string): Reply => ({ id: text, author: { kind: "user" }, text, at });

describe("newReplies", () => {
  it("counts others' replies after the thread was last seen", () => {
    const thread: Thread = { replies: [claude("a", "2026-11-12T10:00:00Z"), mine("b", "2026-11-12T10:05:00Z"), claude("c", "2026-11-12T10:10:00Z")] };
    expect(newReplies(thread).map((r) => r.text)).toEqual(["a", "c"]);
    expect(newReplies({ ...thread, seen: "2026-11-12T10:06:00Z" }).map((r) => r.text)).toEqual(["c"]);
    expect(newReplies({})).toEqual([]);
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
