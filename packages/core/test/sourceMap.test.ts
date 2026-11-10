import { describe, expect, it } from "vitest";
import { locateInSource, sectionAt } from "../src/sourceMap";
import type { Anchor } from "../src/sourceMap";

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

function highlight(exact: string, extra: Partial<Anchor> = {}): Anchor {
  return { quote: { exact, prefix: "", suffix: "" }, position: { start: 0, end: exact.length }, ...extra };
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
