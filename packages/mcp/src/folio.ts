/**
 * folio.ts — What the MCP tools do, without MCP: list the documents under the
 * root, hand an agent their review notes (recording a round), and keep its
 * replies. See docs/design/agent-integration.md.
 *
 * Folio never writes to documents, and neither does this: the agent edits
 * them with its own tools. Only marks in the data folder change.
 */

import { rmSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentsFolder, presenceFile, stopFile, stopRequested, writePresence } from "../../core/src/agents";
import type { StopReason } from "../../core/src/agents";
import { filesOnOtherBranches } from "../../core/src/git";
import { listMarks, MarkError, MarksStore, newRoundId, realPath } from "../../core/src/marks";
import type { DocumentMarks, DocumentNote, Highlight, NoteState } from "../../core/src/marks";
import { answeredBy, formatReviewNotes, isPrivate, reviewPath, sendableNote, shortNoteId } from "../../core/src/reviewNotes";
import type { ReviewDocument } from "../../core/src/reviewNotes";
import { scanWorkspace } from "../../core/src/scanner";
import type { DocumentMeta, ScanOptions } from "../../core/src/scanner";
import { maxDepthSetting, readAppSettings, reviewIntroSetting, skipDirsSetting } from "../../core/src/settings";

// Paths differ only by case on these platforms' default file systems
const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32";
const MARKDOWN = /\.(md|markdown)$/i;
// While waiting for notes: check again this often without a change seen, and
// this long after the last change to the marks folder
const RECHECK_MS = 10_000;
const SETTLE_MS = 300;

// A document only on another git branch keeps its marks where they are, as
// in the desktop app: not moved to a namesake with the same content
const MARKS_OPTIONS = { onOtherBranches: filesOnOtherBranches };

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

export interface WaitRequest {
  /** Only notes sent after this time (ISO 8601); default: from now. */
  since?: string | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

/** Notes the user sent, and the time to wait for the next ones after. */
export interface SentNotes {
  text: string;
  notes: number;
  documents: number;
  since: string;
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
  private readonly dataDir: string;
  /** Rounds this session's waits have given the agent. */
  private readonly delivered = new Set<string>();
  private readonly settings: () => Record<string, unknown>;
  private readonly watching: boolean;
  private scan: { key: string; documents: Promise<DocumentMeta[]> } | null = null;
  private watcher: FSWatcher | null = null;

  constructor(options: FolioOptions) {
    this.root = realPath(options.root);
    this.store = new MarksStore(options.dataDir);
    this.dataDir = options.dataDir;
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
    const { documents: marked } = await listMarks(this.store, this.root, shown, MARKS_OPTIONS);
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

    const { documents: marked } = await listMarks(this.store, this.root, documents, MARKS_OPTIONS);
    const picked: { review: ReviewDocument; highlightIds: string[]; documentNote: boolean }[] = [];
    for (const marks of marked) {
      const doc = documents.find((d) => d.id === marks.docId);
      if (doc === undefined) continue;
      const status = doc.meta?.status ?? null;
      const highlights = marks.highlights.filter((h) => !isPrivate(h) && sendable.has(h.state ?? "open"));
      const sendableDocNote = sendableNote(marks.note, status);
      const note = sendableDocNote !== null && sendable.has(sendableDocNote.state ?? "open") ? sendableDocNote : undefined;
      if (highlights.length === 0 && note === undefined) continue;
      picked.push({
        review: await this.reviewDocument(doc, highlights, note),
        highlightIds: highlights.map((h) => h.id),
        documentNote: note !== undefined,
      });
    }
    if (picked.length === 0) return null;

    const formatted = formatReviewNotes(
      picked.map((p) => p.review),
      reviewIntroSetting(this.settings()),
      { noteIds: true },
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

  private async reviewDocument(doc: DocumentMeta, highlights: Highlight[], note: DocumentNote | undefined): Promise<ReviewDocument> {
    const source = await readFile(path.join(this.root, ...doc.location.split("/")), "utf8");
    return {
      docId: doc.id,
      path: this.absolute(doc.location),
      name: doc.filename,
      source,
      highlights,
      note,
      status: doc.meta?.status ?? null,
      statusLine: doc.meta?.statusLine ?? null,
    };
  }

  // ── Waiting for the user's notes ─────────────────────────────────────────

  /**
   * Wait until the user sends notes on documents under the root after
   * `since` (default: now), then give them as `reviewNotes` does. Sending is
   * Send in the app's Send dialog, offered while this session is live there,
   * which records a round `via: "send"`: an explicit "these are ready",
   * unlike a new highlight, which may be the first of many. Copy, for
   * pasting elsewhere, doesn't count. The round is already recorded, so
   * none is added here.
   *
   * Resolves to `null` at the timeout or when `signal` aborts; the agent
   * calls again with the same `since`. Resolves to why the loop ended when
   * the user ended it in the app, closed its workspace there, or quit the
   * app, now or while the agent worked on the last notes.
   */
  async waitForReview(request: WaitRequest, client: string): Promise<SentNotes | StopReason | null> {
    const since = request.since ?? new Date().toISOString();
    const after = Date.parse(since);
    if (Number.isNaN(after)) throw new FolioError(`${since} isn't a time: pass the since value Folio gave you, or leave it out`);
    const deadline = Date.now() + request.timeoutMs;
    for (let first = true; ; first = false) {
      const stopped = await stopRequested(this.dataDir, process.pid);
      if (stopped !== null) {
        this.leave();
        return stopped;
      }
      if (first) await this.announce({ state: "waiting", since, until: new Date(deadline).toISOString() }, client);
      const sent = await this.sentAfter(after);
      if (sent !== null) {
        // Until the agent calls again, it's working on these
        await this.announce({ state: "working", since: sent.since }, client);
        return sent;
      }
      const left = deadline - Date.now();
      if (left <= 0 || request.signal?.aborted === true) return null;
      await this.marksChange(Math.min(left, RECHECK_MS), request.signal);
    }
  }

  /**
   * Tell the app this session is in a review loop on the root (core
   * agents.ts). Removed by `leave`. Best effort: the wait works without it.
   */
  private async announce(status: { state: "waiting" | "working"; since: string; until?: string }, client: string): Promise<void> {
    try {
      await writePresence(this.dataDir, { pid: process.pid, root: this.root, client, ...status });
    } catch {
      // Unwritable data folder: the app just won't know a session is waiting
    }
  }

  /** Remove this session's presence file: on exit, synchronously. */
  leave(): void {
    rmSync(presenceFile(this.dataDir, process.pid), { force: true });
    rmSync(stopFile(this.dataDir, process.pid), { force: true });
  }

  /**
   * The notes in rounds sent to agents after `after` (ms), as they are now: resolved
   * and private ones left out. Rounds are timed to the second, so one in the
   * same second as `after` counts, unless this session already had it. The
   * rounds are marked picked up, so the app shows their notes being worked on.
   */
  private async sentAfter(after: number): Promise<SentNotes | null> {
    const from = Math.floor(after / 1000) * 1000;
    const documents = await this.documents();
    const { documents: marked } = await listMarks(this.store, this.root, documents, MARKS_OPTIONS);
    const picked: ReviewDocument[] = [];
    let latest = after;
    for (const marks of marked) {
      const rounds = (marks.rounds ?? []).filter((r) => r.via === "send" && Date.parse(r.at) >= from && !this.delivered.has(r.id));
      const doc = documents.find((d) => d.id === marks.docId);
      if (rounds.length === 0 || doc === undefined) continue;
      for (const r of rounds) {
        latest = Math.max(latest, Date.parse(r.at));
        this.delivered.add(r.id);
      }
      try {
        await this.store.markPicked(path.join(this.root, ...doc.location.split("/")), rounds.map((r) => r.id));
      } catch {
        // Best effort: the notes reach the agent either way
      }
      const ids = new Set(rounds.flatMap((r) => r.notes));
      const highlights = marks.highlights.filter((h) => ids.has(h.id) && !isPrivate(h) && h.state !== "resolved");
      const docNote = rounds.some((r) => r.documentNote === true) ? sendableNote(marks.note, doc.meta?.status) : null;
      const note = docNote !== null && docNote.state !== "resolved" ? docNote : undefined;
      if (highlights.length === 0 && note === undefined) continue;
      picked.push(await this.reviewDocument(doc, highlights, note));
    }
    if (picked.length === 0) return null;
    const formatted = formatReviewNotes(picked, reviewIntroSetting(this.settings()), { noteIds: true });
    return {
      text: formatted.text,
      notes: formatted.notes.length + formatted.documentNotes,
      documents: picked.length,
      since: new Date(latest).toISOString(),
    };
  }

  /**
   * Resolves when the marks folder or the agents folder (a stop) changes,
   * once the writes settle, after `ms`, or when `signal` aborts. The timer
   * also covers a folder that doesn't exist yet and file systems where
   * watching misses events.
   */
  private marksChange(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
      const watchers: FSWatcher[] = [];
      let timer: NodeJS.Timeout | undefined = undefined;
      const done = () => {
        clearTimeout(timer);
        for (const w of watchers) w.close();
        signal?.removeEventListener("abort", done);
        resolve();
      };
      timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
      for (const folder of [this.store.folder, agentsFolder(this.dataDir)]) {
        try {
          // A send writes one record per document: wait for the last of them
          const watcher = watch(folder, () => {
            clearTimeout(timer);
            timer = setTimeout(done, SETTLE_MS);
          });
          watcher.on("error", () => watcher.close());
          watchers.push(watcher);
        } catch {
          // No such folder yet: the timer checks again
        }
      }
    });
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

/** A document's notes waiting on the agent: unsent, and sent but not answered yet; not private. */
function waiting(marks: DocumentMarks, status: string | null | undefined): number {
  const busy = (n: { state?: NoteState; replies?: DocumentNote["replies"] }) =>
    n.state === undefined || n.state === "open" || (n.state === "sent" && answeredBy(n) === null);
  const note = sendableNote(marks.note, status);
  return marks.highlights.filter((h) => !isPrivate(h) && busy(h)).length + (note !== null && busy(note) ? 1 : 0);
}

function key(location: string): string {
  return CASE_INSENSITIVE ? location.normalize("NFC").toLowerCase() : location.normalize("NFC");
}

function replied(what: string, note: { state?: NoteState }): string {
  return note.state === "addressed"
    ? `Replied to ${what}; it's marked addressed for the user to check and resolve.`
    : `Replied to ${what}; it waits for the user to answer or resolve it, and isn't sent to you again until they reply.`;
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
