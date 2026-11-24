/**
 * threads.ts — A note's replies (docs/design/agent-integration.md): who
 * wrote them, which the user hasn't seen, and the status bar's summary of
 * the agents' new replies.
 *
 * A reply is new when someone other than the user wrote it after the user
 * last saw the thread (or never did). The user's own replies are never new.
 */

import type { Author, NoteKind, Reply, Thread } from "./types";

/** Who wrote a reply, as the thread shows it. */
export function authorName(author: Author): string {
  switch (author.kind) {
    case "user":
      return "You";
    case "agent":
      return author.name;
    case "github":
      return `@${author.login}`;
  }
}

/**
 * Whether the user can reply: someone else spoke last. The user's own last
 * message (the note, or their reply) is edited instead, until it's answered
 * (docs/design/note-lifecycle.md).
 */
export function canReply(thread: Thread): boolean {
  const last = thread.replies?.[thread.replies.length - 1];
  return (last?.author ?? thread.author ?? { kind: "user" }).kind !== "user";
}

/**
 * The replies the user hasn't seen. Compared as times, not as text: the
 * store writes whole seconds ("…:35Z") and the app marks seen with
 * milliseconds ("…:35.412Z"), which sorts before it as text.
 */
export function newReplies(thread: Thread): Reply[] {
  const seen = thread.seen === undefined ? null : Date.parse(thread.seen);
  return (thread.replies ?? []).filter((r) => r.author.kind !== "user" && (seen === null || Date.parse(r.at) > seen));
}

/**
 * An agent's own note (agent-notes.md) the user hasn't opened yet: new, as
 * an agent's reply is. Opening it marks the thread seen.
 */
export function isNewAgentNote(thread: Thread & { kind?: NoteKind | undefined }): boolean {
  return thread.kind !== undefined && thread.author?.kind === "agent" && thread.seen === undefined;
}

/** What's new on a note, for its labels: "a new question", "a new reply", "3 new replies"; "" when nothing is. */
export function newsOf(thread: Thread & { kind?: NoteKind | undefined }): string {
  const fresh = newReplies(thread).length;
  if (isNewAgentNote(thread)) return fresh === 0 ? "a new question" : `a new question, ${fresh === 1 ? "a reply" : `${fresh} replies`}`;
  return fresh === 0 ? "" : fresh === 1 ? "a new reply" : `${fresh} new replies`;
}

/** A note with new replies, or the agent's own note not opened yet, by where it is. */
export interface RepliedNote {
  docId: string;
  /** null: the note on the document as a whole. */
  highlightId: string | null;
  /** Who replied, in order, each once. */
  authors: string[];
  /** The agent's own note, not opened yet: it asked rather than replied. */
  asked?: boolean;
}

/** The workspace's notes with new replies, in document order. */
export function repliedNotes(
  byDoc: Iterable<[string, { highlights: readonly (Thread & { kind?: NoteKind | undefined })[]; note?: Thread | undefined }]>,
): RepliedNote[] {
  const found: RepliedNote[] = [];
  const add = (docId: string, highlightId: string | null, thread: Thread & { kind?: NoteKind | undefined }) => {
    const asked = isNewAgentNote(thread) && thread.author !== undefined;
    const authors = [...(asked && thread.author !== undefined ? [thread.author] : []), ...newReplies(thread).map((r) => r.author)].map(authorName);
    if (authors.length > 0) found.push({ docId, highlightId, authors: [...new Set(authors)], ...(asked ? { asked } : {}) });
  };
  for (const [docId, marks] of byDoc) {
    if (marks.note !== undefined) add(docId, null, marks.note);
    for (const h of marks.highlights) add(docId, (h as { id?: string }).id ?? null, h);
  }
  return found;
}

/**
 * Who wrote, "Claude Code", what they did, "replied to", and to what, "3
 * notes"; null when there's nothing new. The agent's own new notes are
 * questions it asked; with replies too, they're all "new on" notes.
 */
export function repliesParts(notes: readonly RepliedNote[]): { who: string; did: string; notes: string } | null {
  if (notes.length === 0) return null;
  const authors = [...new Set(notes.flatMap((n) => n.authors))];
  const who = authors.length === 1 ? (authors[0] ?? "") : authors.length === 2 ? `${authors[0]} and ${authors[1]}` : "Agents";
  const asked = notes.filter((n) => n.asked === true).length;
  if (asked === notes.length) return { who, did: "asked", notes: asked === 1 ? "a question" : `${asked} questions` };
  return { who, did: asked === 0 ? "replied to" : "wrote on", notes: notes.length === 1 ? "a note" : `${notes.length} notes` };
}

/** "Claude Code replied to 3 notes", "Claude Code asked 2 questions", or null when there's nothing new. */
export function repliesSummary(notes: readonly RepliedNote[]): string | null {
  const parts = repliesParts(notes);
  return parts === null ? null : `${parts.who} ${parts.did} ${parts.notes}`;
}

const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** When a reply was written, briefly: "just now", "5 min ago", "10:02", "Nov 11". */
export function replyTime(at: string, now: Date = new Date()): string {
  const then = new Date(at);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return clockTime(then, now);
}

/** "10:02" today, else "Nov 11". */
function clockTime(then: Date, now: Date): string {
  return then.toDateString() === now.toDateString() ? TIME.format(then) : DAY.format(then);
}

/** A thread in one line, for the note in the text: what's there and whether any of it is new. */
export interface ThreadSummary {
  /** "3 replies · latest from Claude Code, 10:02", or "1 reply from Claude Code, 10:02". */
  text: string;
  /** When the latest reply was written, in full: the line's tooltip. */
  title: string;
  /** Replies the user hasn't seen. */
  fresh: number;
}

/**
 * The summary line for a thread with replies, else null. The time is the
 * clock's, never "5 min ago": the line isn't redrawn as time passes.
 */
export function threadSummary(thread: Thread, now: Date = new Date()): ThreadSummary | null {
  const replies = thread.replies ?? [];
  const latest = replies[replies.length - 1];
  if (latest === undefined) return null;
  const then = new Date(latest.at);
  const by = `${authorName(latest.author)}, ${clockTime(then, now)}`;
  return {
    text: replies.length === 1 ? `1 reply from ${by}` : `${replies.length} replies · latest from ${by}`,
    title: then.toLocaleString(),
    fresh: newReplies(thread).length,
  };
}
