import { describe, expect, it } from "vitest";
import { findBookmark, headingIdentities, headingIndex, sameHeading } from "./bookmarks";
import type { Bookmark } from "./types";

const headings = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Install" },
  { level: 3, text: "Install" },
  { level: 2, text: "Install" },
];

describe("headingIdentities", () => {
  it("counts earlier headings with the same text and level", () => {
    expect(headingIdentities(headings).map((h) => h.occurrence)).toEqual([0, 0, 0, 1]);
  });
});

describe("headingIndex", () => {
  it("finds the heading a bookmark points at", () => {
    expect(headingIndex(headings, { text: "Install", level: 2, occurrence: 1 })).toBe(3);
    expect(headingIndex(headings, { text: "Install", level: 3, occurrence: 0 })).toBe(2);
  });

  it("is -1 for a heading that's gone", () => {
    expect(headingIndex(headings, { text: "Install", level: 2, occurrence: 2 })).toBe(-1);
    expect(headingIndex(headings, { text: "Usage", level: 2, occurrence: 0 })).toBe(-1);
  });
});

describe("findBookmark", () => {
  const bookmarks: Bookmark[] = [
    { id: "doc", heading: null, created: "" },
    { id: "h", heading: { text: "Install", level: 2, occurrence: 1 }, created: "" },
  ];

  it("tells the document's bookmark from a heading's", () => {
    expect(findBookmark(bookmarks, null)?.id).toBe("doc");
    expect(findBookmark(bookmarks, { text: "Install", level: 2, occurrence: 1 })?.id).toBe("h");
    expect(findBookmark(bookmarks, { text: "Install", level: 2, occurrence: 0 })).toBeUndefined();
  });

  it("never matches a heading to the document", () => {
    expect(sameHeading(null, { text: "", level: 1, occurrence: 0 })).toBe(false);
  });
});
