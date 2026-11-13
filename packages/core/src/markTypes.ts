/**
 * markTypes.ts — The marks' data: highlights, bookmarks, notes and their
 * threads, as records store them (marks.ts, docs/design/marks.md).
 *
 * No Node imports, unlike the store: the frontend's review notes use these
 * types in the browser.
 */

export const COLORS = ["yellow", "green", "blue", "pink"] as const;
export const NOTE_STATES = ["open", "sent", "addressed", "resolved"] as const;

export type Color = (typeof COLORS)[number];

/**
 * Where a note is in the review loop: not sent yet, sent (the agent has it,
 * no answer), addressed (the agent says it's done), resolved (the user
 * agrees). Absent means open.
 */
export type NoteState = (typeof NOTE_STATES)[number];

/** Who wrote a note or reply. Absent on a note: the user. */
export type Author =
  | { kind: "user" }
  /** A coding agent, named after its MCP client ("Claude Code"). */
  | { kind: "agent"; name: string }
  /** A pull request comment the user imported. */
  | { kind: "github"; login: string };

/** An answer in a note's thread. */
export interface Reply {
  id: string;
  author: Author;
  text: string;
  at: string;
}

/** A note's thread (agent-integration): absent fields mean none yet. */
export interface Thread {
  /** Absent: the user. */
  author?: Author;
  /** Oldest first; absent when none. */
  replies?: Reply[];
  /** When the user last saw the thread: replies after it are unseen. */
  seen?: string;
}

export interface Highlight extends Thread {
  id: string;
  color: Color;
  note: string | null;
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
  created: string;
  updated: string;
  /** Absent: open. */
  state?: NoteState;
  /**
   * Set only when the user chose: true keeps the mark out of the loop, false
   * sends a highlight without a note. Absent: private without a note,
   * feedback with one.
   */
  private?: boolean;
}

/** A bookmarked heading: its text, level and which of the same-text, same-level headings. */
export interface BookmarkHeading {
  text: string;
  level: number;
  occurrence: number;
}

export interface Bookmark {
  id: string;
  /** null: the document itself. */
  heading: BookmarkHeading | null;
  created: string;
}

/** A note on the document as a whole: a comment and / or a status to change it to (document-notes.md). */
export interface DocumentNote extends Thread {
  text: string | null;
  requestedStatus: string | null;
  created: string;
  updated: string;
  /** Absent: open. */
  state?: NoteState;
  /** true: kept out of the loop (a requested status is sent anyway). Absent: feedback. */
  private?: boolean;
}

/** Notes sent together: copied, or (later) fetched by an agent. */
export interface Round {
  id: string;
  at: string;
  via: "copy" | "mcp";
  /** The agent that fetched them (via mcp): "Claude Code". */
  client?: string;
  /** The version sent: the document's SHA-1 then. */
  sha1: string;
  /** The highlights sent. */
  notes: string[];
  /** Whether the note on the document as a whole was sent. */
  documentNote?: boolean;
}
