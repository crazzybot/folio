/**
 * anchoring.ts — Finding a highlight again after its document changed.
 *
 * A highlight is saved as its text plus a little of the text around it
 * (the W3C Web Annotation "text quote" model) and its offsets, all in the
 * document's rendered text (textModel.ts). The text decides; offsets are
 * only a hint. Looked up in order:
 *
 *   1. the saved offsets still hold the same text;
 *   2. the text appears elsewhere: the occurrence whose surroundings best
 *      match the saved ones, then the nearest;
 *   3. the text itself changed: whatever now sits between the saved
 *      surroundings, if it still resembles the original;
 *   4. otherwise it's an orphan (null) — kept, but not painted.
 */

import type { TextAnchor } from "./types";

/** Characters of surrounding text saved on each side. */
export const CONTEXT_LENGTH = 32;
// Step 3 matches this much of the surroundings, and needs the new text to
// share at least this fraction with the old
const BRACKET_LENGTH = 16;
const MIN_SIMILARITY = 0.5;

export interface TextSpan {
  start: number;
  end: number;
}

/** The anchor for `text.slice(start, end)`. */
export function describeSpan(text: string, start: number, end: number): TextAnchor {
  return {
    quote: {
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: text.slice(end, end + CONTEXT_LENGTH),
    },
    position: { start, end },
  };
}

/** Where `anchor` is in `text` now, or null if it can't be found. */
export function locateAnchor(text: string, anchor: TextAnchor): TextSpan | null {
  const { exact } = anchor.quote;
  const { start } = anchor.position;
  if (exact === "") return null;

  // 1. Unchanged
  if (text.startsWith(exact, start)) return { start, end: start + exact.length };

  // 2. Moved
  const hits = occurrences(text, exact).map((at) => ({ start: at, end: at + exact.length }));
  if (hits.length > 0) return best(hits, (span) => contextScore(text, span, anchor), start);

  // 3. Edited
  return bracketed(text, anchor);
}

/** Every index of `needle` in `text`. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/** The span with the highest score; ties go to the one nearest `near`. */
function best(spans: TextSpan[], score: (span: TextSpan) => number, near: number): TextSpan | null {
  let chosen: TextSpan | null = null;
  let chosenScore = -Infinity;
  for (const span of spans) {
    const value = score(span);
    if (
      value > chosenScore ||
      (value === chosenScore && chosen !== null && Math.abs(span.start - near) < Math.abs(chosen.start - near))
    ) {
      chosen = span;
      chosenScore = value;
    }
  }
  return chosen;
}

/** How many characters of the saved prefix and suffix match around `span`. */
function contextScore(text: string, span: TextSpan, anchor: TextAnchor): number {
  const { prefix, suffix } = anchor.quote;
  const before = text.slice(Math.max(0, span.start - prefix.length), span.start);
  return commonSuffix(before, prefix) + commonPrefix(text.slice(span.end, span.end + suffix.length), suffix);
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** 0–1: how much of `a` and `b` is shared at their start and end. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const head = commonPrefix(a, b);
  const tail = Math.min(commonSuffix(a, b), Math.min(a.length, b.length) - head);
  return (head + tail) / longest;
}

/**
 * Step 3: the text between the saved surroundings, when they're still there
 * (the start or end of the document counts as surroundings).
 */
function bracketed(text: string, anchor: TextAnchor): TextSpan | null {
  const { exact, prefix, suffix } = anchor.quote;
  const before = prefix.slice(-BRACKET_LENGTH);
  const after = suffix.slice(0, BRACKET_LENGTH);
  // Without either side there's nothing to go by
  if (before === "" && after === "") return null;

  const starts = before === "" ? [0] : occurrences(text, before).map((at) => at + before.length);
  const spans: TextSpan[] = [];
  for (const start of starts) {
    const end = after === "" ? text.length : text.indexOf(after, start);
    // Longer than twice the original: more likely a different place
    if (end > start && end - start <= exact.length * 2 + BRACKET_LENGTH) spans.push({ start, end });
  }
  const similar = spans.filter((span) => similarity(text.slice(span.start, span.end), exact) >= MIN_SIMILARITY);
  return best(similar, (span) => similarity(text.slice(span.start, span.end), exact), anchor.position.start);
}
