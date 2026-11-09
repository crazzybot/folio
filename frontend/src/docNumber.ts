/**
 * docNumber.ts — Numbered documents ("0015-hmac.md", "ADR-015-hmac.md"):
 * the sidebar shows the number in a column before the title, since that's
 * what such documents are known by ("ADR 015"), and hides it from the title
 * when the title repeats it ("ADR 0015: HMAC signatures").
 */

// An optional short word, then the number, then a separator or the end
const NUMBERED = /^(?:[A-Za-z]{2,5}[-_ ]?)?(\d+)(?=[-_. ]|$)/;
// Date-prefixed names ("2026-11-09-notes") are dated, not numbered
const DATED = /^\d{4}-\d{2}-\d{2}/;
// The same in a title: "ADR 0015: …", "1. …", "01 — …"; the separator needs
// a space after it, so "1.5 release notes" keeps its number
const TITLE_NUMBER = /^(?:[A-Za-z]{2,5}[-\s]?)?(\d+)\s*[:.\-–—]\s+/;

/** The number a file name starts with, as written ("0015"), or null. */
export function documentNumber(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  if (DATED.test(stem)) return null;
  return NUMBERED.exec(stem)?.[1] ?? null;
}

/** `title` without a leading mention of `number` ("ADR 0015: HMAC" → "HMAC"); unchanged otherwise. */
export function titleWithoutNumber(title: string, number: string): string {
  const match = TITLE_NUMBER.exec(title);
  if (match?.[1] === undefined || Number(match[1]) !== Number(number)) return title;
  const rest = title.slice(match[0].length);
  return rest === "" ? title : rest;
}
