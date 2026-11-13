/**
 * reviewNotes.ts — A document's highlights and notes as Markdown for a
 * coding agent as review feedback (docs/design/review-notes.md): copied by
 * the app, or fetched by the MCP server.
 *
 * Each quote is located in the document's source (sourceMap.ts), which gives
 * the passage's lines and the headings above it. A quote that isn't found
 * keeps its quote and note without a line.
 *
 * Formatting is stateless: nothing here changes or records the marks. No
 * Node imports: the frontend compiles this for the browser too.
 */

import type { Author, DocumentNote, Highlight, Reply } from "./markTypes";
import { locateInSource } from "./sourceMap";

// Quotes longer than this are shortened to their first and last QUOTE_KEEP
const QUOTE_MAX = 400;
const QUOTE_KEEP = 150;

// ─── Which notes are feedback ─────────────────────────────────────────────────

/** A status as the scanners read it: its first word, lowercased, without trailing punctuation ("Accepted." → "accepted"). */
export function normaliseStatus(text: string): string {
  return (/^\S+/.exec(text.replace(/[*`]/g, "").trim())?.[0] ?? "").replace(/[.,;:!]+$/, "").toLowerCase();
}

/** Whether a document note's requested status is already the document's status. */
export function requestDone(currentStatus: string | null | undefined, requested: string | null | undefined): boolean {
  return currentStatus != null && requested != null && normaliseStatus(requested) === currentStatus;
}

/** Whether a highlight stays out of the loop: locked, or without a note and never sent to the agent. */
export function isPrivate(h: { note: string | null; private?: boolean | undefined }): boolean {
  return h.private ?? (h.note === null || h.note.trim() === "");
}

/**
 * The part of a document's note that goes to the agent: its comment unless
 * locked, and a status change the document doesn't have yet (always
 * feedback). Null when there's nothing to send.
 */
export function sendableNote<T extends Pick<DocumentNote, "text" | "requestedStatus"> & { private?: boolean | undefined }>(
  note: T | undefined,
  status: string | null | undefined,
): T | null {
  if (note === undefined) return null;
  const text = note.private === true ? null : note.text;
  const requestedStatus = requestDone(status, note.requestedStatus) ? null : note.requestedStatus;
  return text === null && requestedStatus === null ? null : { ...note, text, requestedStatus };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** A highlight as formatted: the app's and the store's both fit. */
export type ReviewHighlight = Pick<Highlight, "id" | "note" | "quote" | "position"> & {
  author?: Author | undefined;
  replies?: readonly Reply[] | undefined;
};

/** A document's note as formatted. */
export type ReviewDocumentNote = Pick<DocumentNote, "text" | "requestedStatus"> & {
  replies?: readonly Reply[] | undefined;
};

/** One document's notes to copy. */
export interface ReviewDocument {
  docId: string;
  /** The path the agent is given: absolute in the desktop app, workspace-relative in the browser. */
  path: string;
  /** The file name, for the opening line. */
  name: string;
  /** The document's Markdown source. */
  source: string;
  highlights: readonly ReviewHighlight[];
  /** Highlights known not to be in the current text (the open document's); left out. */
  unplaced?: ReadonlySet<string>;
  /** The note on the document as a whole (document-notes.md): copied before its highlights. */
  note?: ReviewDocumentNote | undefined;
  /** The document's status now (meta.status), and the line it's written on (meta.statusLine). */
  status?: string | null | undefined;
  statusLine?: number | null | undefined;
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
  /** Notes on documents as a whole copied (a comment, or a status change still to make). */
  documentNotes: number;
  /** Status changes asked for that the documents already have: left out. */
  requestsDone: number;
}

/** "file.md", or "3 documents": what {documents} in the opening line stands for. */
function documentsLabel(documents: readonly Pick<ReviewDocument, "name">[]): string {
  return documents.length === 1 ? (documents[0]?.name ?? "the document") : `${documents.length} documents`;
}

/**
 * The default opening line. `withNotes`: some document has a note on it as
 * a whole, copied first; `withQuotes`: some highlight is copied.
 */
export function defaultIntro(
  documents: readonly Pick<ReviewDocument, "name">[],
  { withNotes = false, withQuotes = true }: { withNotes?: boolean; withQuotes?: boolean } = {},
): string {
  const one = documents.length === 1;
  const on = `Review notes on ${one ? (documents[0]?.name ?? "the document") : `${documents.length} documents`}.`;
  const revise = one ? "Please revise the document" : "Please revise the documents";
  if (!withQuotes) return `${on} ${revise} as described below.`;
  const quotes = one ? "each quote from the document" : "each quote from it";
  if (withNotes) {
    const first = one ? "My overall comment comes first" : "Each document's overall comment comes first";
    return `${on} ${first}, then ${quotes} followed by my comment. ${revise} to address them.`;
  }
  return one
    ? `${on} Each quote is from the document, followed by my comment. ${revise} to address them.`
    : `${on} Each quote is from its document, followed by my comment. ${revise} to address them.`;
}

/** `text` as inline code, with enough backticks around it for the ones inside. */
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return longest === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
}

// Front matter at the start of a source (as the scanners find it)
const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n/;

/**
 * The status change a document's note asks for, as an instruction naming
 * where the status is written; null when there's none or it's already made.
 */
export function statusRequest(doc: Pick<ReviewDocument, "note" | "status" | "statusLine" | "source">): string | null {
  const wanted = doc.note?.requestedStatus?.trim();
  if (wanted == null || wanted === "" || requestDone(doc.status, wanted)) return null;
  const status = doc.status ?? null;
  if (status === null) {
    return FRONT_MATTER.test(doc.source)
      ? `Status: add ${code(`status: ${wanted}`)} to its front matter.`
      : `Status: add a ${code(`Status: ${wanted}`)} line under its title.`;
  }
  const line = doc.statusLine == null ? undefined : doc.source.split(/\r\n|\r|\n/)[doc.statusLine - 1]?.trim();
  return line === undefined || line === ""
    ? `Status: change it to "${wanted}". It is "${status}" now.`
    : `Status: change it to "${wanted}". It is "${status}" now, on line ${doc.statusLine}: ${code(line)}.`;
}

/** Who wrote a reply, as the agent is told. */
function byline(author: Author): string {
  switch (author.kind) {
    case "user":
      return "My reply";
    case "agent":
      return `Reply from ${author.name}`;
    case "github":
      return `Reply from @${author.login}`;
  }
}

/** A thread's replies, each "Reply from Claude Code: …", indented by `indent`. */
function replyLines(replies: readonly Reply[] | undefined, indent: string): string[] {
  return (replies ?? []).flatMap((reply) => {
    const [first = "", ...rest] = reply.text.trim().split(/\r?\n/);
    return ["", `${indent}${byline(reply.author)}: ${first}`, ...rest.map((line) => (line.trim() === "" ? "" : `${indent}${line}`))];
  });
}

/** The id the agent is given for a note: its first 8 hex digits, as `folio_reply` takes it. */
export function shortNoteId(highlightId: string): string {
  return highlightId.slice(0, 8);
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
 * heading each. `intro`: the opening line, with {documents} replaced by the
 * file name or "3 documents"; undefined for the default, null for none.
 * `threads`: for an agent that answers in Folio, each note's id on its
 * location line, and the replies so far under each note.
 */
export function formatReviewNotes(
  documents: readonly ReviewDocument[],
  intro?: string | null,
  { threads = false }: { threads?: boolean } = {},
): ReviewNotes {
  const out: string[] = [];
  const notes: ReviewNote[] = [];
  let withoutLine = 0;
  let leftOut = 0;
  let requestsDone = 0;
  let n = 0;

  // What each document has to copy: its note's status change and comment, then its highlights
  const parts = documents.flatMap((doc) => {
    const highlights = [...doc.highlights]
      .filter((h) => {
        const gone = doc.unplaced?.has(h.id) ?? false;
        if (gone) leftOut++;
        return !gone;
      })
      .sort((a, b) => a.position.start - b.position.start);
    const request = statusRequest(doc);
    if (request === null && requestDone(doc.status, doc.note?.requestedStatus)) requestsDone++;
    const comment = doc.note?.text?.trim() || null;
    return highlights.length === 0 && request === null && comment === null ? [] : [{ doc, highlights, request, comment }];
  });
  const copied = parts.length > 0 ? parts.map((part) => part.doc) : documents;
  const documentNotes = parts.filter((part) => part.request !== null || part.comment !== null).length;

  const opening =
    intro === undefined
      ? defaultIntro(copied, { withNotes: documentNotes > 0, withQuotes: parts.some((part) => part.highlights.length > 0) })
      : (intro?.replace(/\{documents\}/g, documentsLabel(copied)) ?? null);
  if (opening !== null && opening.trim() !== "") out.push(opening.trim(), "");

  for (const { doc, highlights, request, comment } of parts) {
    if (documents.length > 1) out.push(`## ${doc.path}`, "");
    // One document: the opening line names only the file, so its note says which one
    else if (request !== null || comment !== null) out.push(`Document: ${doc.path}`);
    if (request !== null) out.push(request, "");
    if (comment !== null) {
      const [first = "", ...rest] = comment.split(/\r?\n/);
      out.push(`Overall: ${first}`, ...rest);
      if (threads) out.push(...replyLines(doc.note?.replies, ""));
      out.push("");
    }

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
      const id = threads ? ` · note ${shortNoteId(h.id)}` : "";
      out.push(`${marker}${doc.path}${lines}${section}${id}`);
      for (const line of shorten(h.quote.exact).split(/\r?\n/)) {
        out.push(line.trim() === "" ? `${indent}>` : `${indent}> ${line}`);
      }
      out.push("");
      const note = h.note?.trim() ? h.note.trim() : "(no comment)";
      for (const line of note.split(/\r?\n/)) out.push(line.trim() === "" ? "" : `${indent}${line}`);
      if (h.author?.kind === "github") out.push(`${indent}— @${h.author.login}`);
      if (threads) out.push(...replyLines(h.replies, indent));

      notes.push({ docId: doc.docId, highlightId: h.id, lines: { start, end: out.length }, located: where !== null });
      out.push("");
    }
  }
  // No trailing blank line
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return { text: out.join("\n"), notes, withoutLine, leftOut, documentNotes, requestsDone };
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
