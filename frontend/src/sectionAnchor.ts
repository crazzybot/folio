/**
 * sectionAnchor.ts — Where a note goes when its passage can't be found:
 * the nearest heading of the section it was in
 * (docs/design/placing-notes.md).
 *
 * A highlight keeps the headings above its passage, outermost first, each
 * identified as a bookmarked heading is (bookmarks.ts). The viewer keeps
 * that path up to date while the passage is found, and falls back to it
 * once it isn't.
 */

import { headingIdentities, sameHeading } from "./bookmarks";
import type { BookmarkHeading } from "./types";

/**
 * The section path of a passage after `headings[index]`: that heading and
 * the ones above it at higher levels, outermost first. Empty for a passage
 * before the first heading (index -1).
 */
export function sectionPath(headings: readonly { level: number; text: string }[], index: number): BookmarkHeading[] {
  const identities = headingIdentities(headings);
  const path: BookmarkHeading[] = [];
  let below = Infinity;
  for (let i = Math.min(index, identities.length - 1); i >= 0; i--) {
    const heading = identities[i] as BookmarkHeading;
    if (heading.level < below) {
      path.unshift(heading);
      below = heading.level;
    }
  }
  return path;
}

/**
 * The index in `headings` of the innermost heading of `section` the
 * document still has, or null when none is left. A heading matches by text,
 * level and occurrence; failing that, by text and level when only one
 * heading has them (an earlier one of the same name was removed).
 */
export function locateSection(
  headings: readonly { level: number; text: string }[],
  section: readonly BookmarkHeading[],
): number | null {
  const identities = headingIdentities(headings);
  for (let i = section.length - 1; i >= 0; i--) {
    const wanted = section[i] as BookmarkHeading;
    const exact = identities.findIndex((h) => sameHeading(h, wanted));
    if (exact !== -1) return exact;
    const named = identities.flatMap((h, at) => (h.text === wanted.text && h.level === wanted.level ? [at] : []));
    if (named.length === 1) return named[0] as number;
  }
  return null;
}

/** Whether two section paths are the same (absent counts as empty). */
export function sameSection(a: readonly BookmarkHeading[] | undefined, b: readonly BookmarkHeading[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((h, i) => sameHeading(h, y[i] ?? null));
}
