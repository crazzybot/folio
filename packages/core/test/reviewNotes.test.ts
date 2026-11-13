import { describe, expect, it } from "vitest";
import type { DocumentNote, Highlight } from "../src/marks";
import { formatReviewNotes, reviewPath, statusRequest } from "../src/reviewNotes";
import type { ReviewDocument } from "../src/reviewNotes";

const SOURCE = `---
title: Event store
---

# Event store

## Context

Events are **append-only**. We keep them forever.

## Decision

We will store events in Postgres, one table per aggregate.
Snapshots are taken every
100 events.

\`\`\`bash
# not a heading
psql -c "select 1"
\`\`\`

### Consequences

Snapshots are taken every 100 events. We keep them forever.

Alternatives
------------

EventStoreDB was rejected for [operational cost](https://example.com/cost).
`;

let ids = 0;
function highlight(exact: string, extra: Partial<Highlight> = {}): Highlight {
  return {
    id: `h${++ids}`,
    color: "yellow",
    note: null,
    quote: { exact, prefix: "", suffix: "" },
    position: { start: 0, end: exact.length },
    created: "2026-11-08T10:00:00Z",
    updated: "2026-11-08T10:00:00Z",
    ...extra,
  };
}

const lineOf = (text: string) => SOURCE.split("\n").findIndex((l) => l.includes(text)) + 1;

function doc(highlights: Highlight[], extra: Partial<ReviewDocument> = {}): ReviewDocument {
  return { docId: "adr", path: "docs/adr.md", name: "adr.md", source: SOURCE, highlights, ...extra };
}

describe("formatReviewNotes", () => {
  it("numbers notes in document order with their location, quote and note", () => {
    const later = highlight("EventStoreDB was rejected", { position: { start: 500, end: 525 } });
    const earlier = highlight("one table per aggregate", { note: "Why not a single table?", position: { start: 100, end: 123 } });
    const { text, notes, withoutLine } = formatReviewNotes([doc([later, earlier])]);
    expect(text).toBe(
      [
        "Review notes on adr.md. Each quote is from the document, followed by my comment. Please revise the document to address them.",
        "",
        `1. docs/adr.md:${lineOf("one table per")} · Event store › Decision`,
        "   > one table per aggregate",
        "",
        "   Why not a single table?",
        "",
        `2. docs/adr.md:${lineOf("EventStoreDB")} · Event store › Alternatives`,
        "   > EventStoreDB was rejected",
        "",
        "   (no comment)",
      ].join("\n"),
    );
    expect(notes.map((n) => [n.highlightId, n.lines])).toEqual([
      [earlier.id, { start: 2, end: 6 }],
      [later.id, { start: 7, end: 11 }],
    ]);
    expect(withoutLine).toBe(0);
  });

  it("indents multi-line quotes and notes, and keeps blank lines inside them", () => {
    const h = highlight("first line\n\nsecond line", { note: "One.\n\nTwo." });
    const { text } = formatReviewNotes([doc([h], { source: "" })], null);
    expect(text).toBe(["1. docs/adr.md", "   > first line", "   >", "   > second line", "", "   One.", "", "   Two."].join("\n"));
  });

  it("indents under two-digit numbers", () => {
    const highlights = Array.from({ length: 10 }, (_, i) => highlight(`quote ${i}`, { position: { start: i, end: i + 1 } }));
    const { text } = formatReviewNotes([doc(highlights, { source: "" })], null);
    expect(text).toContain("10. docs/adr.md\n    > quote 9\n\n    (no comment)");
  });

  it("shortens long quotes", () => {
    const long = "a".repeat(200) + " middle " + "z".repeat(200);
    const { text } = formatReviewNotes([doc([highlight(long)], { source: "" })], null);
    expect(text).toContain(`> ${"a".repeat(150)} … ${"z".repeat(150)}`);
    expect(text).not.toContain("middle");
  });

  it("counts notes without a line and leaves out highlights no longer in the document", () => {
    const missing = highlight("Kafka was chosen");
    const gone = highlight("one table per aggregate");
    const result = formatReviewNotes([doc([missing, gone], { unplaced: new Set([gone.id]) })], null);
    expect(result.notes.map((n) => n.highlightId)).toEqual([missing.id]);
    expect(result.notes[0]?.located).toBe(false);
    expect(result.withoutLine).toBe(1);
    expect(result.leftOut).toBe(1);
    expect(result.text.startsWith("1. docs/adr.md\n")).toBe(true);
  });

  it("gives each of several documents a heading and numbers across them", () => {
    const a = doc([highlight("one table per aggregate")]);
    const b = doc([highlight("EventStoreDB was rejected")], { docId: "other", path: "docs/other.md", name: "other.md" });
    const { text, notes } = formatReviewNotes([a, b]);
    expect(text.startsWith("Review notes on 2 documents.")).toBe(true);
    expect(text).toContain("## docs/adr.md\n\n1. docs/adr.md:");
    expect(text).toContain("## docs/other.md\n\n2. docs/other.md:");
    expect(notes.map((n) => n.docId)).toEqual(["adr", "other"]);
  });

  it("uses a custom opening line, with {documents} replaced", () => {
    const { text } = formatReviewNotes([doc([highlight("one table per aggregate")])], "Fix {documents}, please.");
    expect(text.startsWith("Fix adr.md, please.\n\n1. docs/adr.md:")).toBe(true);
  });

  it("is empty with nothing to copy", () => {
    expect(formatReviewNotes([doc([])]).notes).toEqual([]);
  });
});

describe("reviewPath", () => {
  it("is absolute in the desktop app", () => {
    expect(reviewPath("docs/adr.md", "/Users/me/app/")).toBe("/Users/me/app/docs/adr.md");
    expect(reviewPath("docs/adr.md", "C:\\work\\app", "win32")).toBe("C:\\work\\app\\docs\\adr.md");
  });

  it("is the workspace-relative location in the browser", () => {
    expect(reviewPath("docs/adr.md", null)).toBe("docs/adr.md");
  });
});

describe("formatReviewNotes with a note on the document", () => {
  const ADR = "# ADR 3: HMAC\n\nStatus: proposed · 2026-10-02\n\n## Context\n\nSign with HMAC.\n";
  const note = (requestedStatus: string | null, text: string | null = null): DocumentNote => ({
    text,
    requestedStatus,
    created: "2026-11-09T10:00:00Z",
    updated: "2026-11-09T10:00:00Z",
  });
  const adr = (extra: Partial<ReviewDocument> = {}, highlights: Highlight[] = []): ReviewDocument =>
    doc(highlights, { source: ADR, status: "proposed", statusLine: 3, ...extra });

  it("copies the status change and the overall comment before the highlights", () => {
    const signed = highlight("Sign with HMAC", { position: { start: 40, end: 54 } });
    const result = formatReviewNotes([adr({ note: note("accepted", "Fine once answered.\nSecond line.") }, [signed])]);
    expect(result.text).toBe(
      [
        "Review notes on adr.md. My overall comment comes first, then each quote from the document followed by my comment. Please revise the document to address them.",
        "",
        "Document: docs/adr.md",
        'Status: change it to "accepted". It is "proposed" now, on line 3: `Status: proposed · 2026-10-02`.',
        "",
        "Overall: Fine once answered.",
        "Second line.",
        "",
        "1. docs/adr.md:7 · ADR 3: HMAC › Context",
        "   > Sign with HMAC",
        "",
        "   (no comment)",
      ].join("\n"),
    );
    expect([result.documentNotes, result.requestsDone, result.notes.length]).toEqual([1, 0, 1]);
  });

  it("says where to change or add the status", () => {
    const front = "---\nstatus: proposed\n---\n# T\n";
    expect(statusRequest({ source: front, status: "proposed", statusLine: 2, note: note("Accepted") })).toBe(
      'Status: change it to "Accepted". It is "proposed" now, on line 2: `status: proposed`.',
    );
    expect(statusRequest({ source: "---\ntitle: T\n---\n# T\n", status: null, note: note("accepted") })).toBe(
      "Status: add `status: accepted` to its front matter.",
    );
    expect(statusRequest({ source: "# T\n", status: null, note: note("approved") })).toBe(
      "Status: add a `Status: approved` line under its title.",
    );
    expect(statusRequest({ source: "Status: `x`\n", status: "x", statusLine: 1, note: note("y") })).toBe(
      'Status: change it to "y". It is "x" now, on line 1: `` Status: `x` ``.',
    );
    expect(statusRequest({ source: ADR, status: "proposed", note: note(null, "Text only") })).toBeNull();
  });

  it("leaves out a change the document already has, and counts it", () => {
    const result = formatReviewNotes([adr({ status: "accepted", note: note("Accepted", "Good.") })]);
    expect(result.text).toBe(
      ["Review notes on adr.md. Please revise the document as described below.", "", "Document: docs/adr.md", "Overall: Good."].join("\n"),
    );
    expect([result.documentNotes, result.requestsDone]).toEqual([1, 1]);
  });

  it("copies a document with a note and no highlights", () => {
    const result = formatReviewNotes([adr({ note: note("rejected") })]);
    expect(result.text).toBe(
      [
        "Review notes on adr.md. Please revise the document as described below.",
        "",
        "Document: docs/adr.md",
        'Status: change it to "rejected". It is "proposed" now, on line 3: `Status: proposed · 2026-10-02`.',
      ].join("\n"),
    );
  });

  it("puts each document's note under its heading", () => {
    const other = highlight("Snapshots are taken every 100 events", { position: { start: 300, end: 336 } });
    const result = formatReviewNotes([
      adr({ docId: "a", path: "docs/a.md", name: "a.md", note: note("accepted", "Ship it.") }),
      doc([other], { docId: "b", path: "docs/b.md", name: "b.md" }),
    ]);
    const lines = result.text.split("\n");
    expect(lines[0]).toBe(
      "Review notes on 2 documents. Each document's overall comment comes first, then each quote from it followed by my comment. Please revise the documents to address them.",
    );
    expect(lines.slice(2, 8)).toEqual([
      "## docs/a.md",
      "",
      'Status: change it to "accepted". It is "proposed" now, on line 3: `Status: proposed · 2026-10-02`.',
      "",
      "Overall: Ship it.",
      "",
    ]);
    expect(lines[8]).toBe("## docs/b.md");
    expect(lines[10]?.startsWith("1. docs/b.md:")).toBe(true);
  });
});

describe("formatReviewNotes for an agent", () => {
  it("gives each note's id and its replies", () => {
    const h = highlight("one table per aggregate", {
      id: "a1b2c3d4e5f60718",
      note: "Why not a single table?",
      replies: [
        { id: "r1", author: { kind: "agent", name: "Claude Code" }, text: "Which table?", at: "2026-11-10T10:02:00Z" },
        { id: "r2", author: { kind: "user" }, text: "The events table.\n\nOne for all.", at: "2026-11-10T10:05:00Z" },
      ],
    });
    const { text } = formatReviewNotes([doc([h])], null, { threads: true });
    expect(text).toBe(
      [
        `1. docs/adr.md:${lineOf("one table per")} · Event store › Decision · note a1b2c3d4`,
        "   > one table per aggregate",
        "",
        "   Why not a single table?",
        "",
        "   Reply from Claude Code: Which table?",
        "",
        "   My reply: The events table.",
        "",
        "   One for all.",
      ].join("\n"),
    );
    // Copied by hand: neither
    expect(formatReviewNotes([doc([h])], null).text).not.toContain("a1b2c3d4");
  });

  it("names an imported comment's author", () => {
    const h = highlight("one table per aggregate", { note: "Nit.", author: { kind: "github", login: "octocat" } });
    expect(formatReviewNotes([doc([h])], null).text.split("\n").slice(-2)).toEqual(["   Nit.", "   — @octocat"]);
  });

  it("gives the replies to the document's note", () => {
    const n: DocumentNote = {
      text: "Ship it.",
      requestedStatus: null,
      created: "2026-11-08T10:00:00Z",
      updated: "2026-11-08T10:00:00Z",
      replies: [{ id: "r1", author: { kind: "agent" as const, name: "Codex" }, text: "Done.", at: "2026-11-10T10:02:00Z" }],
    };
    const { text } = formatReviewNotes([doc([], { note: n })], null, { threads: true });
    expect(text).toBe(["Document: docs/adr.md", "Overall: Ship it.", "", "Reply from Codex: Done."].join("\n"));
  });
});
