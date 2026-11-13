/**
 * folio.ts — What the MCP tools do, without MCP: list the documents under the
 * root, hand an agent their review notes (recording a round), and keep its
 * replies. See docs/design/agent-integration.md.
 *
 * Folio never writes to documents, and neither does this: the agent edits
 * them with its own tools. Only marks in the data folder change.
 */

import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listMarks, MarkError, MarksStore, newRoundId, realPath } from "../../core/src/marks";
import type { DocumentMarks, DocumentNote, Highlight, NoteState } from "../../core/src/marks";
import { formatReviewNotes, isPrivate, reviewPath, sendableNote, shortNoteId } from "../../core/src/reviewNotes";
import type { ReviewDocument } from "../../core/src/reviewNotes";
import { scanWorkspace } from "../../core/src/scanner";
import type { DocumentMeta, ScanOptions } from "../../core/src/scanner";
import { maxDepthSetting, readAppSettings, reviewIntroSetting, skipDirsSetting } from "../../core/src/settings";

// Paths differ only by case on these platforms' default file systems
const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32";
const MARKDOWN = /\.(md|markdown)$/i;

/** A refusal the agent is told about: a bad path or note id. */
export class FolioError extends Error {}

export interface FolioOptions {
  /** The folder the agent works in; documents outside it are refused. */
  root: string;
  /** Where marks live: ~/.folio by default. */
  dataDir: string;
  /** The app's settings, read again on each call; defaults to its settings.json. */
  settings?: () => Record<string, unknown>;
  /** Watch the root to keep the scan cached (off in tests). */
  watch?: boolean;
}

/** A document as `folio_list_documents` returns it. */
export interface ListedDocument {
  path: string;
  title: string;
  status: string | null;
  tags: string[];
  /** Notes for the agent not yet addressed: unsent and sent. */
  openNotes: number;
}

export interface ListFilter {
  folder?: string | undefined;
  status?: string | undefined;
  tag?: string | undefined;
  withOpenNotes?: boolean | undefined;
}

export interface NotesRequest {
  paths?: string[] | undefined;
  includeSent?: boolean | undefined;
  includeAddressed?: boolean | undefined;
}

export interface ReplyRequest {
  noteId?: string | undefined;
  path?: string | undefined;
  text: string;
  addressed?: boolean | undefined;
}

export class Folio {
  readonly root: string;
  private readonly store: MarksStore;
  private readonly settings: () => Record<string, unknown>;
  private readonly watching: boolean;
  private scan: { key: string; documents: Promise<DocumentMeta[]> } | null = null;
  private watcher: FSWatcher | null = null;

  constructor(options: FolioOptions) {
    this.root = realPath(options.root);
    this.store = new MarksStore(options.dataDir);
    this.settings = options.settings ?? (() => readAppSettings());
    this.watching = options.watch ?? true;
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  // ── Documents ────────────────────────────────────────────────────────────

  private scanOptions(): ScanOptions {
    const settings = this.settings();
    return { skipDirs: new Set(skipDirsSetting(settings["skipDirs"])), maxDepth: maxDepthSetting(settings["maxDepth"]) };
  }

  /**
   * The documents under the root. The scan is kept until a Markdown file or
   * folder under the root changes (or the scan settings do), so only the
   * first call in a session pays for it.
   */
  private documents(): Promise<DocumentMeta[]> {
    const options = this.scanOptions();
    const key = JSON.stringify([[...(options.skipDirs ?? [])], options.maxDepth]);
    if (this.scan === null || this.scan.key !== key || !this.watching) {
      this.startWatching();
      this.scan = { key, documents: scanWorkspace(this.root, options) };
    }
    return this.scan.documents;
  }

  private startWatching(): void {
    if (!this.watching || this.watcher !== null) return;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, name) => {
        // A folder rename has no extension; anything else that isn't Markdown can't change the list
        if (name === null || MARKDOWN.test(name) || path.extname(name) === "") this.scan = null;
      });
      this.watcher.on("error", () => this.stopWatching());
      this.watcher.unref();
    } catch {
      // No recursive watching here: scan on every call
      this.stopWatching();
    }
  }

  private stopWatching(): void {
    this.close();
    this.scan = null;
  }

  /** The workspace-relative location of `p` (absolute, or relative to the root), refused outside the root. */
  location(p: string): string {
    const full = realPath(path.resolve(this.root, p));
    const fold = (s: string) => (CASE_INSENSITIVE ? s.toLowerCase() : s);
    const relative = path.relative(fold(this.root), fold(full));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new FolioError(`${p} is outside ${this.root}, the folder Folio was started in`);
    }
    // In the file's own case: the folded one only tells whether it's inside
    return full.slice(full.length - relative.length).split(path.sep).join("/");
  }

  /** The absolute path the agent is given for a location. */
  private absolute(location: string): string {
    return reviewPath(location, this.root, process.platform);
  }

  async listDocuments(filter: ListFilter = {}): Promise<ListedDocument[]> {
    const documents = await this.documents();
    const folder = filter.folder === undefined ? null : this.location(filter.folder);
    const inFolder = (location: string) => folder === null || folder === "" || location.startsWith(`${folder}/`);
    const status = filter.status?.trim().toLowerCase();
    const tag = filter.tag?.trim().toLowerCase().replace(/^#/, "");
    const shown = documents.filter(
      (doc) =>
        inFolder(doc.location) &&
        (status === undefined || doc.meta?.status === status) &&
        (tag === undefined || (doc.meta?.tags ?? []).includes(tag)),
    );
    const { documents: marked } = await listMarks(this.store, this.root, shown);
    const open = new Map(marked.map((m) => [m.docId, waiting(m, shown.find((d) => d.id === m.docId)?.meta?.status)]));
    return shown
      .map((doc) => ({
        path: this.absolute(doc.location),
        title: doc.title,
        status: doc.meta?.status ?? null,
        tags: doc.meta?.tags ?? [],
        openNotes: open.get(doc.id) ?? 0,
      }))
      .filter((doc) => filter.withOpenNotes !== true || doc.openNotes > 0);
  }

  // ── Review notes ─────────────────────────────────────────────────────────

  /**
   * The review notes for `paths` (default: every document under the root
   * with notes to send), as Copy review notes words them, with each note's
   * id and replies. Unsent notes become sent, and a round is recorded for
   * each document. Null when there's nothing to send.
   */
  async reviewNotes(request: NotesRequest, client: string): Promise<{ text: string; notes: number; documents: number } | null> {
    const all = await this.documents();
    let documents = all;
    if (request.paths !== undefined && request.paths.length > 0) {
      const wanted = new Set(request.paths.map((p) => key(this.location(p))));
      documents = all.filter((doc) => wanted.has(key(doc.location)));
      const found = new Set(documents.map((doc) => key(doc.location)));
      const missing = request.paths.filter((p) => !found.has(key(this.location(p))));
      if (missing.length > 0) throw new FolioError(`Not a Markdown document Folio lists: ${missing.join(", ")}`);
    }

    const sendable = new Set<NoteState>(["open"]);
    if (request.includeSent === true) sendable.add("sent");
    if (request.includeAddressed === true) sendable.add("addressed");

    const { documents: marked } = await listMarks(this.store, this.root, documents);
    const picked: { review: ReviewDocument; highlightIds: string[]; documentNote: boolean }[] = [];
    for (const marks of marked) {
      const doc = documents.find((d) => d.id === marks.docId);
      if (doc === undefined) continue;
      const status = doc.meta?.status ?? null;
      const highlights = marks.highlights.filter((h) => !isPrivate(h) && sendable.has(h.state ?? "open"));
      const sendableDocNote = sendableNote(marks.note, status);
      const note = sendableDocNote !== null && sendable.has(sendableDocNote.state ?? "open") ? sendableDocNote : undefined;
      if (highlights.length === 0 && note === undefined) continue;
      const source = await readFile(path.join(this.root, ...doc.location.split("/")), "utf8");
      picked.push({
        review: {
          docId: doc.id,
          path: this.absolute(doc.location),
          name: doc.filename,
          source,
          highlights,
          note,
          status,
          statusLine: doc.meta?.statusLine ?? null,
        },
        highlightIds: highlights.map((h) => h.id),
        documentNote: note !== undefined,
      });
    }
    if (picked.length === 0) return null;

    const formatted = formatReviewNotes(
      picked.map((p) => p.review),
      reviewIntroSetting(this.settings()),
      { threads: true },
    );
    const roundId = newRoundId();
    for (const p of picked) {
      await this.store.send(p.review.path, {
        roundId,
        highlightIds: p.highlightIds,
        documentNote: p.documentNote,
        via: "mcp",
        client,
      });
    }
    return { text: formatted.text, notes: formatted.notes.length + formatted.documentNotes, documents: picked.length };
  }

  // ── Replies ──────────────────────────────────────────────────────────────

  /**
   * Answer a note: the highlight `noteId` (its id, or the first 8 hex digits
   * the review notes give), or with `path` alone the note on that document as
   * a whole. Resolves to a sentence saying what happened.
   */
  async reply(request: ReplyRequest, client: string): Promise<string> {
    const body = { author: { kind: "agent", name: client }, text: request.text, addressed: request.addressed === true };
    try {
      if (request.noteId !== undefined) {
        const { file, highlight } = await this.findNote(request.noteId);
        const note = (await this.store.reply(file, highlight.id, body)) as Highlight;
        return replied(`note ${shortNoteId(note.id)}`, note);
      }
      if (request.path !== undefined) {
        const location = this.location(request.path);
        const file = path.join(this.root, ...location.split("/"));
        const note = (await this.store.reply(file, null, body)) as DocumentNote;
        return replied(`the note on ${this.absolute(location)}`, note);
      }
    } catch (err) {
      if (err instanceof MarkError) throw new FolioError(err.message);
      throw err;
    }
    throw new FolioError("Give noteId for a note on a passage, or path for the note on a document as a whole");
  }

  /** The highlight whose id starts with `noteId`, among the root's documents. */
  private async findNote(noteId: string): Promise<{ file: string; highlight: Highlight }> {
    const id = noteId.trim().toLowerCase();
    if (!/^[0-9a-f]{8,16}$/.test(id)) throw new FolioError(`${noteId} isn't a note id: 8 to 16 hex digits, as the review notes give it`);
    const found = [...(await this.store.inWorkspace(this.root)).values()].flatMap(({ record }) =>
      record.highlights.filter((h) => h.id.startsWith(id)).map((highlight) => ({ file: record.path, highlight })),
    );
    const [first, second] = found;
    if (first === undefined) throw new FolioError(`No note ${noteId} under ${this.root}`);
    if (second !== undefined) throw new FolioError(`Several notes start with ${noteId}: give more of its id`);
    return first;
  }
}

/** A document's notes waiting on the agent: unsent and sent, not private. */
function waiting(marks: DocumentMarks, status: string | null | undefined): number {
  const busy = (state: NoteState | undefined) => state === undefined || state === "open" || state === "sent";
  const note = sendableNote(marks.note, status);
  return marks.highlights.filter((h) => !isPrivate(h) && busy(h.state)).length + (note !== null && busy(note.state) ? 1 : 0);
}

function key(location: string): string {
  return CASE_INSENSITIVE ? location.normalize("NFC").toLowerCase() : location.normalize("NFC");
}

function replied(what: string, note: { state?: NoteState }): string {
  return note.state === "addressed"
    ? `Replied to ${what}; it's marked addressed for the user to check and resolve.`
    : `Replied to ${what}; it stays open for the user to answer.`;
}

/** The agent's name for its replies, from the MCP client's: "claude-code" → "Claude Code". */
export function agentName(clientName: string | undefined): string {
  const known: Record<string, string> = {
    "claude-code": "Claude Code",
    "claude-ai": "Claude",
    cursor: "Cursor",
    "cursor-vscode": "Cursor",
    "codex-mcp-client": "Codex",
    codex: "Codex",
    "gemini-cli-mcp-client": "Gemini CLI",
    windsurf: "Windsurf",
    zed: "Zed",
  };
  const name = clientName?.trim() ?? "";
  if (name === "") return "Agent";
  const lower = name.toLowerCase();
  if (known[lower] !== undefined) return known[lower];
  // "my-agent" → "My Agent"; a name with capitals or spaces is kept as it is
  return /^[a-z0-9_-]+$/.test(name)
    ? name.split(/[-_]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ")
    : name.slice(0, 100);
}
