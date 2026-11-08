import { describe, expect, it } from "vitest";
import { formatReviewNotes, locateInSource, reviewPath, sectionAt } from "./reviewNotes";
import type { ReviewDocument } from "./reviewNotes";
import type { Highlight } from "./types";

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

describe("locateInSource", () => {
  it("finds a quote on one line, with its section", () => {
    const where = locateInSource(SOURCE, highlight("one table per aggregate"));
    expect(where).toEqual({ startLine: lineOf("one table per"), endLine: lineOf("one table per"), section: ["Event store", "Decision"] });
  });

  it("finds a quote across lines", () => {
    const where = locateInSource(SOURCE, highlight("Snapshots are taken every 100 events"));
    // The first occurrence spans two lines; with no context to tell them apart, the nearest to the rendered position wins
    expect(where?.startLine).toBe(lineOf("Snapshots are taken every"));
    expect(where?.endLine).toBe(lineOf("100 events."));
  });

  it("tells duplicates apart by the text around them", () => {
    const later = highlight("Snapshots are taken every 100 events", {
      quote: { exact: "Snapshots are taken every 100 events", prefix: "Consequences ", suffix: ". We keep them forever." },
    });
    const where = locateInSource(SOURCE, later);
    expect(where?.startLine).toBe(lineOf("Snapshots are taken every 100 events."));
    expect(where?.section).toEqual(["Event store", "Decision", "Consequences"]);
  });

  it("ignores emphasis inside the quote", () => {
    expect(locateInSource(SOURCE, highlight("Events are append-only."))?.startLine).toBe(lineOf("append-only"));
  });

  it("uses setext headings and skips headings inside code", () => {
    const where = locateInSource(SOURCE, highlight("EventStoreDB was rejected"));
    expect(where?.section).toEqual(["Event store", "Alternatives"]);
    expect(locateInSource(SOURCE, highlight('select 1"'))?.section).toEqual(["Event store", "Decision"]);
  });

  it("finds quotes around links and autolinks", () => {
    expect(locateInSource(SOURCE, highlight("rejected for operational cost."))?.startLine).toBe(lineOf("EventStoreDB"));
    const source = "Para.\n\n> **Tip.** The selector at <https://example.com/get/> always works.";
    expect(locateInSource(source, highlight("Tip. The selector at https://example.com/get/ always"))?.startLine).toBe(3);
  });

  it("returns null when the quote isn't in the source", () => {
    expect(locateInSource(SOURCE, highlight("Kafka was chosen"))).toBeNull();
    expect(locateInSource(SOURCE, highlight("  "))).toBeNull();
  });
});

describe("sectionAt", () => {
  it("doesn't take front matter for a setext heading", () => {
    expect(sectionAt(SOURCE, 4)).toEqual([]);
  });

  it("closes deeper headings at the same or a higher level", () => {
    const source = "# A\n## B\n### C\n## D\ntext";
    expect(sectionAt(source, 5)).toEqual(["A", "D"]);
  });

  it("strips inline markup from heading text", () => {
    expect(sectionAt("## The `store` and [[Events|events]] *now* ##\ntext", 2)).toEqual(["The store and events now"]);
  });
});

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
