/**
 * reviewNotes.ts — A document's highlights and notes as Markdown to paste
 * into a coding agent as review feedback (docs/design/review-notes.md).
 *
 * Highlights are anchored to the rendered text, but the agent works with the
 * source, so each quote is looked for in the source: with Markdown
 * punctuation, link destinations and whitespace left out on both sides,
 * keeping where each remaining character came from. That gives the
 * passage's lines and the headings above it. A quote that isn't found (from
 * HTML, or text Folio renders differently) keeps its quote and note without
 * a line.
 *
 * Copying is stateless: nothing here changes or records the marks.
 */

import type { Highlight } from "./types";

// Left out when a quote is looked for in the source: Markdown punctuation,
// escapes, list dashes and autolinks' brackets, and all whitespace (rendered
// blocks may or may not have whitespace between them). Links' destinations,
// `](url)`, are skipped too: only their text is rendered.
const MARKUP = /[\s*_`~#<>|[\]\\-]/;

// Quotes longer than this are shortened to their first and last QUOTE_KEEP
const QUOTE_MAX = 400;
const QUOTE_KEEP = 150;

/** Where a passage is in the source: 1-based lines, and the headings above it, outermost first. */
export interface SourceLocation {
  startLine: number;
  endLine: number;
  section: string[];
}

/** The source with markup and whitespace left out, lowercased, and each character's offset in the source. */
function collapse(source: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    // A link's destination: `](url "title")` on one line
    if (ch === "]" && source[i + 1] === "(") {
      const close = source.indexOf(")", i + 2);
      if (close !== -1 && !source.slice(i + 2, close).includes("\n")) {
        i = close;
        continue;
      }
    }
    if (MARKUP.test(ch)) continue;
    text += ch.toLowerCase();
    offsets.push(i);
  }
  return { text, offsets };
}

const plain = (text: string) => collapse(text).text;

/** How many characters `a` and `b` share at their ends (`fromEnd`) or starts. */
function shared(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
  return n;
}

/**
 * Find a highlight's passage in the document's source, or null when it
 * isn't there. Of several occurrences, the one whose surroundings best match
 * the highlight's prefix and suffix wins; ties go to the one nearest where
 * the highlight was in the rendered text (roughly: the rendered text isn't
 * the source).
 */
export function locateInSource(source: string, anchor: Pick<Highlight, "quote" | "position">): SourceLocation | null {
  const quote = plain(anchor.quote.exact);
  if (quote === "") return null;
  const { text, offsets } = collapse(source);
  const prefix = plain(anchor.quote.prefix);
  const suffix = plain(anchor.quote.suffix);
  // The rendered position, scaled to the collapsed text
  const expected = source.length === 0 ? 0 : (anchor.position.start * text.length) / source.length;

  let best = -1;
  let bestScore = -1;
  let bestDistance = Infinity;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const score =
      shared(text.slice(Math.max(0, at - prefix.length), at), prefix, true) +
      shared(text.slice(at + quote.length, at + quote.length + suffix.length), suffix, false);
    const distance = Math.abs(at - expected);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = at;
      bestScore = score;
      bestDistance = distance;
    }
  }
  if (best === -1) return null;

  const start = offsets[best] ?? 0;
  const end = offsets[best + quote.length - 1] ?? start;
  const startLine = lineOf(source, start);
  return { startLine, endLine: lineOf(source, end), section: sectionAt(source, startLine) };
}

/** The 1-based line of a source offset. */
function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === "\n") line++;
  return line;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A heading's text without inline markup: links and wiki links by their text, emphasis and code marks dropped. */
function headingText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

/**
 * The headings `line` is under (1-based), outermost first: ATX and setext
 * headings, not inside fenced code or the YAML front matter.
 */
export function sectionAt(source: string, line: number): string[] {
  const lines = source.split(/\r?\n/);
  const stack: { level: number; text: string }[] = [];
  const push = (level: number, text: string) => {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    if (text !== "") stack.push({ level, text });
  };

  let i = 0;
  // Front matter: from a first line of --- to the next --- or ...
  if (lines[0]?.trim() === "---") {
    i = lines.findIndex((l, n) => n > 0 && (l.trim() === "---" || l.trim() === "..."));
    i = i === -1 ? lines.length : i + 1;
  }
  let fence: string | null = null;
  for (; i < line && i < lines.length; i++) {
    const text = lines[i] ?? "";
    const marker = FENCE.exec(text)?.[1];
    if (fence !== null) {
      // A fence closes with the same character, at least as long
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const atx = ATX.exec(text);
    if (atx !== null) {
      push(atx[1]?.length ?? 1, headingText(atx[2] ?? ""));
      continue;
    }
    // A setext underline makes the line above it a heading
    const next = lines[i + 1];
    if (next !== undefined && i + 1 < lines.length && text.trim() !== "" && SETEXT.test(next) && !/^ {0,3}[-*+>]\s/.test(text)) {
      push(next.trim().startsWith("=") ? 1 : 2, headingText(text));
      i++;
    }
  }
  return stack.map((h) => h.text);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** One document's notes to copy. */
export interface ReviewDocument {
  docId: string;
  /** The path the agent is given: absolute in the desktop app, workspace-relative in the browser. */
  path: string;
  /** The file name, for the opening line. */
  name: string;
  /** The document's Markdown source. */
  source: string;
  highlights: readonly Highlight[];
  /** Highlights known not to be in the current text (the open document's); left out. */
  unplaced?: ReadonlySet<string>;
}

/** A note in the copied text. */
export interface ReviewNote {
  docId: string;
  highlightId: string;
  /** The text lines it fills, 0-based, end exclusive. */
  lines: { start: number; end: number };
  /** Found in the source: it has a line and section. */
  located: boolean;
}

export interface ReviewNotes {
  text: string;
  notes: ReviewNote[];
  /** Notes copied without a line number (not found in the source). */
  withoutLine: number;
  /** Highlights left out because they're no longer in the document. */
  leftOut: number;
}

/** The default opening line. */
export function defaultIntro(documents: readonly Pick<ReviewDocument, "name">[]): string {
  return documents.length === 1
    ? `Review notes on ${documents[0]?.name ?? "the document"}. Each quote is from the document, followed by my comment. Please revise the document to address them.`
    : `Review notes on ${documents.length} documents. Each quote is from its document, followed by my comment. Please revise the documents to address them.`;
}

/** A quote over QUOTE_MAX characters, shortened to its first and last QUOTE_KEEP. */
function shorten(quote: string): string {
  const text = quote.trim();
  if (text.length <= QUOTE_MAX) return text;
  return `${text.slice(0, QUOTE_KEEP).trimEnd()} … ${text.slice(-QUOTE_KEEP).trimStart()}`;
}

/**
 * The documents' highlights as numbered review notes, in document order and
 * numbered across documents: the location (`path:line · Section › Sub`), the
 * quote and the note, or "(no comment)". Several documents get a `## path`
 * heading each. `intro` null leaves the opening line out.
 */
export function formatReviewNotes(documents: readonly ReviewDocument[], intro?: string | null): ReviewNotes {
  const out: string[] = [];
  const notes: ReviewNote[] = [];
  let withoutLine = 0;
  let leftOut = 0;
  let n = 0;

  const opening = intro === undefined ? defaultIntro(documents) : intro;
  if (opening !== null && opening.trim() !== "") out.push(opening.trim(), "");

  for (const doc of documents) {
    const highlights = [...doc.highlights]
      .filter((h) => {
        const gone = doc.unplaced?.has(h.id) ?? false;
        if (gone) leftOut++;
        return !gone;
      })
      .sort((a, b) => a.position.start - b.position.start);
    if (highlights.length === 0) continue;
    if (documents.length > 1) out.push(`## ${doc.path}`, "");

    for (const h of highlights) {
      n++;
      const marker = `${n}. `;
      const indent = " ".repeat(marker.length);
      const where = locateInSource(doc.source, h);
      if (where === null) withoutLine++;
      const start = out.length;

      const lines =
        where === null
          ? ""
          : where.endLine > where.startLine
            ? `:${where.startLine}-${where.endLine}`
            : `:${where.startLine}`;
      const section = where !== null && where.section.length > 0 ? ` · ${where.section.join(" › ")}` : "";
      out.push(`${marker}${doc.path}${lines}${section}`);
      for (const line of shorten(h.quote.exact).split(/\r?\n/)) {
        out.push(line.trim() === "" ? `${indent}>` : `${indent}> ${line}`);
      }
      out.push("");
      const note = h.note?.trim() ? h.note.trim() : "(no comment)";
      for (const line of note.split(/\r?\n/)) out.push(line.trim() === "" ? "" : `${indent}${line}`);

      notes.push({ docId: doc.docId, highlightId: h.id, lines: { start, end: out.length }, located: where !== null });
      out.push("");
    }
  }
  // No trailing blank line
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return { text: out.join("\n"), notes, withoutLine, leftOut };
}

/**
 * The path to give the agent: absolute in the desktop app (the workspace
 * isn't always the repository the agent runs in, so a relative path could be
 * wrong), the workspace-relative location in the browser.
 */
export function reviewPath(location: string, workspacePath: string | null | undefined, platform?: string): string {
  if (!workspacePath) return location;
  const windows = platform === "win32";
  const sep = windows ? "\\" : "/";
  const root = workspacePath.replace(/[\\/]+$/, "");
  return root + sep + (windows ? location.replace(/\//g, "\\") : location);
}
