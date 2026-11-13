/**
 * reads.ts — New and changed documents (docs/design/reads.md): each
 * document's state from its read record, and the words for it. The records
 * are kept by useReads.ts.
 */

import type { DocumentRead } from "./types";

/** New: never read (it appeared after Folio first saw the workspace). Changed: edited since it was read. */
export type ReadState = "new" | "changed" | "read";

export function readStateOf(entry: DocumentRead | undefined): ReadState {
  if (entry === undefined) return "read"; // Nothing known: no marker
  if (entry.read === null) return "new";
  return entry.read.sha1 === entry.sha1 ? "read" : "changed";
}

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** For the hover card: "Changed since you read it on 3 Nov", "New"; null when read. */
export function readSentence(entry: DocumentRead | undefined): string | null {
  const state = readStateOf(entry);
  if (state === "new") return "New since you last looked";
  if (state === "read" || entry?.read == null) return null;
  return entry.baseline
    ? `Changed since Folio first saw it on ${DATE.format(new Date(entry.read.at))}`
    : `Changed since you read it on ${DATE.format(new Date(entry.read.at))}`;
}

/** "3 unread" in a folder's documents, from their ids. */
export function unreadCount(ids: Iterable<string>, unreadIds: ReadonlySet<string>): number {
  let count = 0;
  for (const id of ids) if (unreadIds.has(id)) count++;
  return count;
}
