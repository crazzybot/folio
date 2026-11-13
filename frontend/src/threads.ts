/**
 * threads.ts — A note's replies (docs/design/agent-integration.md): who
 * wrote them, which the user hasn't seen, and the status bar's summary of
 * the agents' new replies.
 *
 * A reply is new when someone other than the user wrote it after the user
 * last saw the thread (or never did). The user's own replies are never new.
 */

import type { Author, Reply, Thread } from "./types";

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

/** The replies the user hasn't seen. */
export function newReplies(thread: Thread): Reply[] {
  return (thread.replies ?? []).filter((r) => r.author.kind !== "user" && (thread.seen === undefined || r.at > thread.seen));
}

/** A note with new replies, by where it is. */
export interface RepliedNote {
  docId: string;
  /** null: the note on the document as a whole. */
  highlightId: string | null;
  /** Who replied, in order, each once. */
  authors: string[];
}

/** The workspace's notes with new replies, in document order. */
export function repliedNotes(
  byDoc: Iterable<[string, { highlights: readonly Thread[]; note?: Thread | undefined }]>,
): RepliedNote[] {
  const found: RepliedNote[] = [];
  const add = (docId: string, highlightId: string | null, thread: Thread) => {
    const replies = newReplies(thread);
    if (replies.length > 0) found.push({ docId, highlightId, authors: [...new Set(replies.map((r) => authorName(r.author)))] });
  };
  for (const [docId, marks] of byDoc) {
    if (marks.note !== undefined) add(docId, null, marks.note);
    for (const h of marks.highlights) add(docId, (h as { id?: string }).id ?? null, h);
  }
  return found;
}

/** "Claude Code replied to 3 notes", or null when there's nothing new. */
export function repliesSummary(notes: readonly RepliedNote[]): string | null {
  if (notes.length === 0) return null;
  const authors = [...new Set(notes.flatMap((n) => n.authors))];
  const who = authors.length === 1 ? authors[0] : authors.length === 2 ? `${authors[0]} and ${authors[1]}` : "Agents";
  return `${who} replied to ${notes.length === 1 ? "a note" : `${notes.length} notes`}`;
}

const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** When a reply was written, briefly: "just now", "5 min ago", "10:02", "Nov 11". */
export function replyTime(at: string, now: Date = new Date()): string {
  const then = new Date(at);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return then.toDateString() === now.toDateString() ? TIME.format(then) : DAY.format(then);
}
