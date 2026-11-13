/**
 * headings.ts — Front matter and headings in Markdown text, line by line:
 * what the scanner lists and the sections a change is counted in
 * (sections.ts). No Node imports: the frontend compiles this for the
 * browser too.
 */

/** A section heading, for searching titles and headings without reading files. */
export interface Heading {
  level: number; // 1-6
  text: string; // as rendered: no markdown syntax
}

// One heading line: "## Text", optional closing #s; up to 3 spaces of indent
export const HEADING_LINE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
// An HTML heading on one line, as READMEs centre their title: <h1 align="center">Name</h1>
const HTML_HEADING_LINE = /^ {0,3}<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1\s*>/i;
const HTML_TAG = /<[^>]*>/g;
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MAX_HEADINGS = 200;

// YAML front matter at the very start of a file (as Obsidian, Jekyll, Hugo… write it)
export const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const FRONT_MATTER_TITLE = /^title[ \t]*:[ \t]*(.+?)[ \t]*$/m;

/** The text after any front matter, and the front matter's `title:`, if set. */
export function splitFrontMatter(text: string): { body: string; title: string | null } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { body: text, title: null };
  const raw = FRONT_MATTER_TITLE.exec(match[1] ?? "")?.[1];
  const title = raw === undefined ? null : raw.replace(/^(["'])(.*)\1$/, "$2").trim() || null;
  return { body: text.slice(match[0].length), title };
}

/**
 * How a [[wiki link]] reads: its alias, else "Note > Heading", "Note" or
 * "Heading" (block references, #^id, are left out). Matches the viewer.
 */
export function wikiLinkText(inner: string): string {
  const bar = inner.indexOf("|");
  if (bar >= 0) return inner.slice(bar + 1).trim();
  const hash = inner.indexOf("#");
  const name = (hash >= 0 ? inner.slice(0, hash) : inner).trim();
  const heading = hash >= 0 && !inner.slice(hash + 1).startsWith("^") ? inner.slice(hash + 1).trim() : "";
  return name && heading ? `${name} > ${heading}` : name || heading;
}

/** Heading text as rendered: link text instead of links, no emphasis or code markers. */
export function plainHeading(raw: string): string {
  return raw
    .replace(/!?\[\[([^\]]*)\]\]/g, (_match, inner: string) => wikiLinkText(inner))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A heading and the index of its line in the text it was found in. */
export interface HeadingLine extends Heading {
  line: number;
}

/**
 * ATX (# … ######) and one-line HTML headings outside fenced code blocks in
 * `lines` (Markdown without its front matter), in order, with their line.
 */
export function headingLines(lines: readonly string[], max = Infinity): HeadingLine[] {
  const headings: HeadingLine[] = [];
  let fence: string | null = null;
  for (const [index, line] of lines.entries()) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      const marker = fenceMatch[1];
      // A fence closes with the same character, at least as long
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    let level: number;
    let raw: string;
    const match = HEADING_LINE.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      level = match[1].length;
      raw = match[2];
    } else {
      const htmlMatch = HTML_HEADING_LINE.exec(line);
      if (htmlMatch?.[1] === undefined || htmlMatch[2] === undefined) continue;
      level = Number(htmlMatch[1]);
      raw = htmlMatch[2].replace(HTML_TAG, "");
    }
    const headingText = plainHeading(raw);
    if (headingText === "") continue;
    headings.push({ level, text: headingText, line: index });
    if (headings.length >= max) break;
  }
  return headings;
}

/** ATX (# … ######) and one-line HTML headings outside fenced code blocks, in document order. */
export function extractHeadings(text: string): Heading[] {
  return headingLines(splitFrontMatter(text).body.split(/\r\n|\r|\n/), MAX_HEADINGS).map(({ level, text }) => ({ level, text }));
}
