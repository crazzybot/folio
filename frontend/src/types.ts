/** A section heading, as rendered (no markdown syntax). */
export interface Heading {
  level: number; // 1-6
  text: string;
}

/** What a document says about itself: front matter fields, or its status line. */
export interface Metadata {
  /** First word of the status, lowercased: "accepted", "superseded", "draft"… */
  status: string | null;
  /** The status as written, when it says more than that word ("superseded by ADR-0005"); may hold Markdown links. */
  statusDetail: string | null;
  date: string | null;
  /** decision-makers / deciders. */
  people: string[];
  /** Lowercased, without "#". */
  tags: string[];
  /** The 1-based line the status is written on (front matter or a "Status:" line); null without a status. */
  statusLine: number | null;
}

export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root
  title: string;
  created: string; // ISO-8601
  headings: Heading[];
  /** Left out when the document has none of its fields. */
  meta?: Metadata;
}

export interface DocumentContent {
  id: string;
  content: string;
  /** The SHA-1 of the version shown, which Mark as read records; absent when it couldn't be read. */
  sha1?: string;
}

/** A version of a document that was read (packages/core/src/reads.ts). */
export interface ReadVersion {
  sha1: string;
  /** ISO-8601. */
  at: string;
}

/** A document's current version and what was last read of it. */
export interface DocumentRead {
  docId: string;
  sha1: string;
  /** Null when it was never read: it appeared after Folio first saw the workspace. */
  read: ReadVersion | null;
  /** Recorded when Folio first saw the workspace, not actually read. */
  baseline: boolean;
}

/** A matching line in a document (full-text search). */
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
  /** The first few matches. */
  matches: SearchMatch[];
}

export type PanelSide = "left" | "right";

/** Whether the desktop window's history has entries behind / ahead of the current one. */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

// ─── Marks ───────────────────────────────────────────────────────────────────

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Where a highlight is in the document's rendered text (see anchoring.ts). */
export interface TextAnchor {
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
}

/**
 * Where a note is in the review loop (docs/design/sending-notes.md): not sent
 * yet, sent (the agent has it), addressed (the agent says it's done),
 * resolved (the user agrees).
 */
export type NoteState = "open" | "sent" | "addressed" | "resolved";

/** Who wrote a note or reply: the user, a coding agent (over MCP), or an imported pull request comment. */
export type Author = { kind: "user" } | { kind: "agent"; name: string } | { kind: "github"; login: string };

/** An answer in a note's thread (docs/design/agent-integration.md). */
export interface Reply {
  id: string;
  author: Author;
  text: string;
  at: string; // ISO-8601
}

/** A note's thread; absent fields mean none yet. */
export interface Thread {
  /** Absent: the user. */
  author?: Author;
  /** Oldest first. */
  replies?: Reply[];
  /** When the user last saw the thread: replies after it are new. */
  seen?: string;
}

export interface Highlight extends TextAnchor, Thread {
  id: string;
  color: HighlightColor;
  note: string | null;
  created: string; // ISO-8601
  updated: string;
  /** Absent: open. */
  state?: NoteState;
  /** Set only when the user chose (Only me, Send to agent); absent: private without a note, feedback with one. */
  private?: boolean;
}

/** A bookmarked heading: its text, level and which of the same-text, same-level headings (0 = first). */
export interface BookmarkHeading {
  text: string;
  level: number;
  occurrence: number;
}

export interface Bookmark {
  id: string;
  /** null: the document itself. */
  heading: BookmarkHeading | null;
  created: string; // ISO-8601
}

/** A document that has marks. */
/** A note on the document as a whole: a comment and / or a status to ask for (document-notes.md). */
export interface DocumentNote extends Thread {
  /** Markdown, or null. */
  text: string | null;
  /** The status to ask the document's author to change it to, or null. */
  requestedStatus: string | null;
  created: string; // ISO-8601
  updated: string;
  /** Absent: open. */
  state?: NoteState;
  /** true: Only me. A requested status is sent anyway. */
  private?: boolean;
}

/** Notes sent together: copied, or fetched by an agent. */
export interface Round {
  id: string;
  at: string; // ISO-8601
  via: "copy" | "mcp";
  /** The agent that fetched them (via mcp): "Claude Code". */
  client?: string;
  /** The document's SHA-1 when sent. */
  sha1: string;
  /** The highlights sent. */
  notes: string[];
  documentNote?: boolean;
}

export interface DocumentMarks {
  docId: string;
  location: string;
  /** Absent when there's none. */
  note?: DocumentNote;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** The latest rounds its notes were sent in, oldest first; absent when none. */
  rounds?: Round[];
}

/** One document's notes in a send. */
export interface SendDocument {
  docId: string;
  highlightIds: string[];
  /** Whether its note on the document as a whole is sent. */
  documentNote: boolean;
}

/** A recorded send: per document, the notes it made sent (what Undo sets back to open). */
export interface SentRound {
  roundId: string;
  documents: SendDocument[];
}

/** The marks of a file in the workspace that no longer exists. */
export interface MissingMarks {
  /** Identifies the marks, to move or delete them. */
  recordId: string;
  note?: DocumentNote;
  /** Where the file was (workspace-relative). */
  location: string;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  /** The document they probably belong to now: same name, and most marks found in it. */
  suggestion: { docId: string; location: string } | null;
  /** The other git branch the file is on; absent when it's on none. */
  branch?: string;
}

/** A worktree of a git repository (desktop/src/git.ts). */
export interface GitWorktree {
  path: string;
  /** Null when its HEAD is detached. */
  branch: string | null;
  /** The worktree the workspace is in. */
  current: boolean;
}

/** A git repository of the workspace (desktop/src/git.ts). */
export interface GitRepository {
  /** Its root's workspace location ("projects/api"); "" for the repository the workspace is in. */
  location: string;
  /** Its root's absolute path. */
  root: string;
  /** Null when HEAD is detached. */
  branch: string | null;
  /** The short commit of HEAD; null before the first commit. */
  head: string | null;
  /** "origin/main", "main" or "master"; null when there's none of those. */
  base: string | null;
  /** For a linked worktree, the path of the main checkout; else null. */
  mainCheckout: string | null;
  worktrees: GitWorktree[];
}

export interface GitState {
  repositories: GitRepository[];
}

export interface MarksListing {
  documents: DocumentMarks[];
  missing: MissingMarks[];
}
