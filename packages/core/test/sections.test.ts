import { describe, expect, it } from "vitest";
import { changeCount, sectionChanges } from "../src/sections";

const BEFORE = `---
status: proposed
---
# Event store

Intro text.

## Decision

We will use Postgres.

### Details

One table per aggregate.

## Consequences

Snapshots every 100 events.

## Open questions

None yet.
`;

describe("sectionChanges", () => {
  it("finds nothing between versions that differ only in whitespace", () => {
    const changes = sectionChanges(BEFORE, BEFORE.replace("We will use Postgres.", "We will  use\nPostgres."));
    expect(changeCount(changes)).toBe(0);
  });

  it("lists changed, added and removed sections, a subsection apart from its parent", () => {
    const after = BEFORE.replace("One table per aggregate.", "One stream per aggregate.")
      .replace("## Open questions\n\nNone yet.\n", "## Alternatives\n\nEventStoreDB.\n");
    const changes = sectionChanges(BEFORE, after);
    expect(changes.changed).toEqual([{ level: 3, text: "Details" }]);
    expect(changes.added).toEqual([{ level: 2, text: "Alternatives" }]);
    expect(changes.removed).toEqual([{ level: 2, text: "Open questions" }]);
    expect([changes.intro, changes.frontMatter]).toEqual([false, false]);
    expect(changeCount(changes)).toBe(3);
  });

  it("counts the front matter and the text before the first heading on their own", () => {
    const after = BEFORE.replace("status: proposed", "status: accepted").replace("Intro text.", "New intro.");
    const changes = sectionChanges(BEFORE, after);
    // "Intro text." is under "# Event store", the first heading
    expect(changes.changed).toEqual([{ level: 1, text: "Event store" }]);
    expect([changes.intro, changes.frontMatter]).toEqual([false, true]);
    expect(sectionChanges("Preamble.\n\n# A\n", "Changed.\n\n# A\n").intro).toBe(true);
  });

  it("tells repeated headings apart by their order, and ignores headings in code", () => {
    const before = "## Notes\n\none\n\n## Notes\n\ntwo\n\n```\n## not a heading\n```\n";
    const after = "## Notes\n\none\n\n## Notes\n\nthree\n\n```\n## not a heading, edited\n```\n";
    // The code block belongs to the second "Notes"
    expect(sectionChanges(before, after).changed).toEqual([{ level: 2, text: "Notes" }]);
  });
});
