import path from "node:path";
import { describe, expect, it } from "vitest";
import { alertText, ReplyAlerts, unseenNotes } from "../src/replyAlerts";
import type { MarksRecord } from "../../packages/core/src/marks";
import type { Highlight, Reply } from "../../packages/core/src/markTypes";

const work = path.resolve("/work");

const reply = (id: string, at: string, name: string | null = "Claude Code"): Reply => ({
  id,
  author: name === null ? { kind: "user" } : { kind: "agent", name },
  text: id,
  at,
});

const highlight = (id: string, replies: Reply[], seen?: string): Highlight => ({
  id,
  color: "yellow",
  note: "a note",
  quote: { exact: "x", prefix: "", suffix: "" },
  position: { start: 0, end: 1 },
  created: "2026-11-14T10:00:00Z",
  updated: "2026-11-14T10:00:00Z",
  replies,
  ...(seen === undefined ? {} : { seen }),
});

const record = (file: string, highlights: Highlight[], documentNote?: MarksRecord["documentNote"]): MarksRecord => ({
  version: 1,
  path: file,
  fingerprint: { sha1: "", size: 0, filename: path.basename(file) },
  bookmarks: [],
  highlights,
  ...(documentNote === undefined ? {} : { documentNote }),
});

describe("unseenNotes", () => {
  it("finds agent replies after the thread was last seen, in the workspace only", () => {
    const notes = unseenNotes(work, [
      record(path.join(work, "docs", "a.md"), [
        highlight("h1", [reply("r1", "2026-11-14T10:01:00Z"), reply("r2", "2026-11-14T10:05:00Z")], "2026-11-14T10:02:00Z"),
        highlight("h2", [reply("r3", "2026-11-14T10:01:00Z")], "2026-11-14T10:02:00Z"),
        highlight("h3", [reply("r4", "2026-11-14T10:01:00Z", null)]),
      ]),
      record(path.join(work, "b.md"), [], {
        text: "overall",
        requestedStatus: null,
        created: "",
        updated: "",
        replies: [reply("r5", "2026-11-14T10:01:00Z")],
      }),
      record(path.resolve("/elsewhere/c.md"), [highlight("h4", [reply("r6", "2026-11-14T10:01:00Z")])]),
    ]);
    expect(notes.map((n) => [n.document, n.replyIds])).toEqual([
      [path.join("docs", "a.md"), ["r2"]],
      ["b.md", ["r5"]],
    ]);
  });
});

describe("alertText", () => {
  it("names the agent, counts the notes and names a single document", () => {
    const notes = unseenNotes(work, [
      record(path.join(work, "a.md"), [highlight("h1", [reply("r1", "t")]), highlight("h2", [reply("r2", "t")])]),
    ]);
    expect(alertText(notes)).toEqual({ title: "Claude Code replied to 2 notes", body: "a.md" });
    expect(alertText([])).toBeNull();
  });

  it("counts documents and says Agents when several replied", () => {
    const notes = unseenNotes(work, [
      record(path.join(work, "a.md"), [highlight("h1", [reply("r1", "t")])]),
      record(path.join(work, "b.md"), [highlight("h2", [reply("r2", "t", "Cursor")])]),
    ]);
    expect(alertText(notes)).toEqual({ title: "Agents replied to 2 notes", body: "In 2 documents" });
  });
});

describe("ReplyAlerts", () => {
  const notesWith = (...ids: string[]) =>
    unseenNotes(work, [record(path.join(work, "a.md"), ids.map((id) => highlight(`h-${id}`, [reply(id, "t")])))]);

  it("badges replies from before the start without telling about them", () => {
    const alerts = new ReplyAlerts();
    expect(alerts.check(notesWith("r1"))).toEqual({ badge: 1, fresh: [] });
  });

  it("tells about each new reply once", () => {
    const alerts = new ReplyAlerts();
    alerts.check(notesWith("r1"));
    const { badge, fresh } = alerts.check(notesWith("r1", "r2"));
    expect(badge).toBe(2);
    expect(fresh.map((n) => n.replyIds)).toEqual([["r2"]]);
    expect(alerts.check(notesWith("r1", "r2")).fresh).toEqual([]);
  });

  it("forgets a workspace's replies on reset", () => {
    const alerts = new ReplyAlerts();
    alerts.check([]);
    alerts.reset();
    expect(alerts.check(notesWith("r1")).fresh).toEqual([]);
  });
});
