/**
 * bookmarks.ts — Which heading a bookmark points at.
 *
 * Heading anchors are slugs of their text, and two headings with the same
 * text share one, so a bookmarked heading is kept as its text and level
 * plus `occurrence`: how many earlier headings have the same text and level.
 * The same identity is worked out from the rendered document (the viewer)
 * and from the scanned heading list (the Marks view).
 */

import type { Bookmark, BookmarkHeading } from "./types";

/** The identity of each heading in `headings` (in document order). */
export function headingIdentities(headings: readonly { level: number; text: string }[]): BookmarkHeading[] {
  const seen = new Map<string, number>();
  return headings.map(({ level, text }) => {
    const key = `${level}\0${text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { text, level, occurrence };
  });
}

export function sameHeading(a: BookmarkHeading | null, b: BookmarkHeading | null): boolean {
  return a === null || b === null ? a === b : a.text === b.text && a.level === b.level && a.occurrence === b.occurrence;
}

/** The bookmark for the document (`heading` null) or one of its headings, if there is one. */
export function findBookmark(bookmarks: readonly Bookmark[], heading: BookmarkHeading | null): Bookmark | undefined {
  return bookmarks.find((b) => sameHeading(b.heading, heading));
}

/** Index of `heading` in `headings`' identities, or -1 when the document no longer has it. */
export function headingIndex(headings: readonly { level: number; text: string }[], heading: BookmarkHeading): number {
  return headingIdentities(headings).findIndex((h) => sameHeading(h, heading));
}
