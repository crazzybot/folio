import { describe, expect, it } from "vitest";
import { locateSection, sameSection, sectionPath } from "./sectionAnchor";

const h = (level: number, text: string) => ({ level, text });
const id = (level: number, text: string, occurrence = 0) => ({ level, text, occurrence });

const HEADINGS = [h(1, "Spec"), h(2, "Context"), h(2, "Design"), h(3, "Storage"), h(3, "Notes"), h(2, "Notes"), h(3, "Notes")];

describe("sectionPath", () => {
  it("is the heading before the passage and those above it", () => {
    expect(sectionPath(HEADINGS, 3)).toEqual([id(1, "Spec"), id(2, "Design"), id(3, "Storage")]);
    expect(sectionPath(HEADINGS, 6)).toEqual([id(1, "Spec"), id(2, "Notes"), id(3, "Notes", 1)]);
    expect(sectionPath(HEADINGS, 1)).toEqual([id(1, "Spec"), id(2, "Context")]);
  });

  it("is empty before the first heading", () => {
    expect(sectionPath(HEADINGS, -1)).toEqual([]);
    expect(sectionPath([], 0)).toEqual([]);
  });

  it("skips levels the document doesn't use", () => {
    expect(sectionPath([h(1, "A"), h(3, "B"), h(2, "C"), h(4, "D")], 3)).toEqual([id(1, "A"), id(2, "C"), id(4, "D")]);
  });
});

describe("locateSection", () => {
  const path = [id(1, "Spec"), id(2, "Design"), id(3, "Storage")];

  it("finds the innermost heading still there", () => {
    expect(locateSection(HEADINGS, path)).toBe(3);
    // Storage removed: its parent
    expect(locateSection([h(1, "Spec"), h(2, "Design"), h(3, "Notes")], path)).toBe(1);
  });

  it("matches by occurrence, or by name when only one heading has it", () => {
    expect(locateSection(HEADINGS, [id(3, "Notes", 1)])).toBe(6);
    // The first "Storage" was removed: the one left is occurrence 0 now
    expect(locateSection([h(3, "Storage")], [id(3, "Storage", 1)])).toBe(0);
    // Two left: which one is unknown
    expect(locateSection([h(3, "Notes"), h(3, "Notes")], [id(3, "Notes", 2)])).toBeNull();
  });

  it("is null when no heading of the path is left", () => {
    expect(locateSection([h(1, "Other")], path)).toBeNull();
    expect(locateSection(HEADINGS, [])).toBeNull();
  });
});

describe("sameSection", () => {
  it("compares paths, absent as empty", () => {
    expect(sameSection(undefined, [])).toBe(true);
    expect(sameSection([id(1, "A")], [id(1, "A")])).toBe(true);
    expect(sameSection([id(1, "A")], [id(1, "A", 1)])).toBe(false);
    expect(sameSection([id(1, "A")], undefined)).toBe(false);
  });
});
