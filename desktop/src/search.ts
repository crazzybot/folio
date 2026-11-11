/**
 * search.ts — Full-text search across the workspace's markdown files.
 *
 * A case-insensitive plain-text match (no regex). Each result carries the
 * document's match count and a few matching lines as snippets; a snippet's
 * `occurrence` is the 0-based index of its match among all matches in the
 * document, so the viewer can scroll to that match.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { scanWorkspace } from "../../packages/core/src/scanner";
import type { ScanOptions } from "../../packages/core/src/scanner";

export interface SearchMatch {
  /** 1-based line number. */
  line: number;
  /** The line, shortened around the match when long. */
  text: string;
  /** The match within `text`: [start, end). */
  start: number;
  end: number;
  /** 0-based index of this match among the document's matches. */
  occurrence: number;
}

export interface SearchResult {
  id: string;
  matchCount: number;
  matches: SearchMatch[];
}

export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 200;
const MAX_SNIPPETS = 3;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // larger files are skipped
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;
const READ_CONCURRENCY = 16;

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

/** Documents whose text contains `query`, in document-list order. */
export async function searchWorkspace(
  workspace: string,
  query: string,
  options: ScanOptions = {},
): Promise<SearchResult[]> {
  const needle = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const docs = await scanWorkspace(workspace, options);
  const found: (SearchResult | null)[] = new Array(docs.length).fill(null);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < docs.length) {
      const index = next++;
      const doc = docs[index];
      if (doc === undefined) continue;
      try {
        const fullPath = path.join(workspace, doc.location);
        if ((await fs.stat(fullPath)).size > MAX_FILE_BYTES) continue;
        const result = searchContent(await fs.readFile(fullPath, "utf8"), needle);
        if (result !== null) found[index] = { id: doc.id, ...result };
      } catch {
        // Removed or unreadable since the scan: not a match
      }
    }
  }

  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  return found.filter((result): result is SearchResult => result !== null).slice(0, MAX_RESULTS);
}
