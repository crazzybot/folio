import { describe, expect, it } from "vitest";
import { readSentence, readStateOf, unreadCount } from "./reads";
import type { DocumentRead } from "./types";

const entry = (sha1: string, read: string | null, baseline = false): DocumentRead => ({
  docId: "a",
  sha1,
  read: read === null ? null : { sha1: read, at: "2026-11-03T10:00:00Z" },
  baseline,
});

describe("readStateOf", () => {
  it("tells new, changed and read apart", () => {
    expect(readStateOf(entry("x", null))).toBe("new");
    expect(readStateOf(entry("y", "x"))).toBe("changed");
    expect(readStateOf(entry("x", "x"))).toBe("read");
    // Nothing known (e.g. the listing failed): no marker
    expect(readStateOf(undefined)).toBe("read");
  });
});

describe("readSentence", () => {
  it("says since when a document changed, and who saw it then", () => {
    expect(readSentence(entry("y", "x"))).toMatch(/^Changed since you read it on /);
    expect(readSentence(entry("y", "x", true))).toMatch(/^Changed since Folio first saw it on /);
    expect(readSentence(entry("x", null))).toBe("New since you last looked");
    expect(readSentence(entry("x", "x"))).toBeNull();
  });
});

describe("unreadCount", () => {
  it("counts the unread among ids", () => {
    expect(unreadCount(["a", "b", "c"], new Set(["b", "c", "z"]))).toBe(2);
  });
});
