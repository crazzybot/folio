/**
 * replyAlerts.ts — Telling the user an agent answered their notes, when
 * they're not looking at Folio: the Dock badge counts the workspace's notes
 * with replies the user hasn't seen, and a system notification says when new
 * ones arrive ("Claude Code replied to 4 notes").
 *
 * A reply is unseen as in the frontend's threads.ts: an agent wrote it after
 * the user last saw the thread.
 */

import path from "node:path";
import type { MarksRecord } from "../../packages/core/src/marks";
import type { Thread } from "../../packages/core/src/markTypes";

/** A workspace note with agent replies the user hasn't seen. */
export interface UnseenNote {
  /** The record's document path and the highlight id ("" for the document's note). */
  key: string;
  /** The document's path, relative to the workspace. */
  document: string;
  /** The ids of its unseen agent replies. */
  replyIds: string[];
  /** Who replied, each once, in order. */
  agents: string[];
}

function unseen(thread: Thread): { ids: string[]; agents: string[] } {
  const ids: string[] = [];
  const agents: string[] = [];
  for (const r of thread.replies ?? []) {
    if (r.author.kind !== "agent" || (thread.seen !== undefined && r.at <= thread.seen)) continue;
    ids.push(r.id);
    if (!agents.includes(r.author.name)) agents.push(r.author.name);
  }
  return { ids, agents };
}

/** The notes of documents in `workspace` with agent replies the user hasn't seen. */
export function unseenNotes(workspace: string, records: Iterable<MarksRecord>): UnseenNote[] {
  const notes: UnseenNote[] = [];
  for (const record of records) {
    const document = path.relative(workspace, record.path);
    if (document === "" || document.startsWith("..") || path.isAbsolute(document)) continue;
    const threads: [string, Thread][] = record.highlights.map((h) => [h.id, h]);
    if (record.documentNote !== undefined) threads.push(["", record.documentNote]);
    for (const [id, thread] of threads) {
      const { ids, agents } = unseen(thread);
      if (ids.length > 0) notes.push({ key: `${record.path}#${id}`, document, replyIds: ids, agents });
    }
  }
  return notes;
}

/** What a notification about `notes` says, or null when there's nothing new. */
export function alertText(notes: readonly UnseenNote[]): { title: string; body: string } | null {
  if (notes.length === 0) return null;
  const agents = [...new Set(notes.flatMap((n) => n.agents))];
  const who = agents.length === 1 ? (agents[0] as string) : "Agents";
  const count = notes.length === 1 ? "1 note" : `${notes.length} notes`;
  const documents = [...new Set(notes.map((n) => n.document))];
  const body = documents.length === 1 ? (documents[0] as string) : `In ${documents.length} documents`;
  return { title: `${who} replied to ${count}`, body };
}

/**
 * Tracks which replies the user was already told about. The first check
 * only remembers them: replies from before the app started get the badge,
 * not a notification.
 */
export class ReplyAlerts {
  private told: Set<string> | null = null;

  /** The badge count for `notes`, and the notes with replies not told about yet. */
  check(notes: readonly UnseenNote[]): { badge: number; fresh: UnseenNote[] } {
    const first = this.told === null;
    const told = this.told ?? new Set<string>();
    const fresh = first ? [] : notes.filter((n) => n.replyIds.some((id) => !told.has(id)));
    // Only unseen replies are kept, so the set doesn't grow
    this.told = new Set(notes.flatMap((n) => n.replyIds));
    return { badge: notes.length, fresh };
  }

  /** Another workspace: its replies so far aren't news. */
  reset(): void {
    this.told = null;
  }
}
