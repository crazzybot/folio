/**
 * demo/search.ts — Full-text search for the live demo, done in the page,
 * mirroring desktop/src/search.ts.
 * desktop/test/demoSearch.test.ts runs both on the same inputs.
 *
 * A case-insensitive plain-text match (no regex). Each result carries the
 * document's match count and a few matching lines as snippets; a snippet's
 * `occurrence` is the 0-based index of its match among all matches in the
 * document, so the viewer can scroll to that match.
 */

import type { SearchMatch, SearchResult } from "../types";

export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 200;
const MAX_SNIPPETS = 3;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/** The line around [start, end), shortened to a snippet with "…" where cut. */
function snippet(line: string, start: number, end: number): Pick<SearchMatch, "text" | "start" | "end"> {
  const from = Math.max(0, start - SNIPPET_BEFORE);
  const to = Math.min(line.length, end + SNIPPET_AFTER);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < line.length ? "…" : "";
  // Leading indentation carries no meaning in a snippet
  const body = line.slice(from, to);
  const trimmed = prefix ? body : body.trimStart();
  const shift = prefix.length - (body.length - trimmed.length) - from;
  return { text: prefix + trimmed + suffix, start: start + shift, end: end + shift };
}

/** Matches of `needle` (lowercase) in `content`, or null when there are none. */
export function searchContent(content: string, needle: string): Omit<SearchResult, "id"> | null {
  const matches: SearchMatch[] = [];
  let matchCount = 0;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lower = line.toLowerCase();
    let at = lower.indexOf(needle);
    while (at !== -1) {
      if (matches.length < MAX_SNIPPETS) {
        matches.push({ line: i + 1, occurrence: matchCount, ...snippet(line, at, at + needle.length) });
      }
      matchCount++;
      at = lower.indexOf(needle, at + needle.length);
    }
  }
  return matchCount === 0 ? null : { matchCount, matches };
}

/** Documents whose text contains `query`, in the order of `documents`. */
export function searchDocuments(
  documents: readonly { id: string }[],
  contents: Readonly<Record<string, string>>,
  query: string,
): SearchResult[] {
  const needle = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  if (needle.length < MIN_QUERY_LENGTH) return [];
  const found: SearchResult[] = [];
  for (const doc of documents) {
    const content = contents[doc.id];
    if (content === undefined) continue;
    const result = searchContent(content, needle);
    if (result !== null) found.push({ id: doc.id, ...result });
    if (found.length === MAX_RESULTS) break;
  }
  return found;
}
