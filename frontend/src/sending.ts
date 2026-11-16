/**
 * sending.ts — Which marks are feedback and where each is in the review
 * loop, and what the Send dialog lists and ticks (docs/design/sending-notes.md).
 *
 * A highlight without a note is private, one with a note is feedback,
 * unless the user chose otherwise (`private`: Only me, or Send to agent).
 * Feedback is open until sent; the agent may then say it's addressed, and
 * the user resolves it, or answer it, and the user replies or resolves it. Private marks have no part in any of it.
 */

import type { NoteIconKind } from "./noteIcons";
import { answeredBy, isPrivate, sendableNote } from "../../packages/core/src/reviewNotes";
import { newReplies } from "./threads";
import type { DocumentMeta, DocumentNote, Highlight, NoteState, Round, SendDocument } from "./types";

/** What the Marks view's state filter tells apart: the four states, and private marks. */
export type StateFilter = NoteState | "private";

export const STATE_FILTERS: readonly { value: StateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "sent", label: "Sent" },
  { value: "addressed", label: "Addressed" },
  { value: "resolved", label: "Resolved" },
  { value: "private", label: "Private" },
];

/** What the Marks view shows while no state is picked: everything but resolved notes. */
export const DEFAULT_STATE_FILTER: ReadonlySet<StateFilter> = new Set(["open", "sent", "addressed", "private"]);

/** The states shown for the ones picked in the filter: picking narrows, none picked is the default. */
export function shownStates(picked: ReadonlySet<StateFilter>): ReadonlySet<StateFilter> {
  return picked.size === 0 ? DEFAULT_STATE_FILTER : picked;
}

export function stateOf(mark: { state?: NoteState | undefined }): NoteState {
  return mark.state ?? "open";
}

// Shared with the MCP server, which sends the same notes
export { answeredBy, isPrivate, sendableNote };

/** A note's icon, for a note in the loop: answered when the agent's reply is the latest on a sent note, else its state. */
export function loopKind(mark: { state?: NoteState | undefined; replies?: Highlight["replies"] }): Exclude<NoteIconKind, "private"> {
  return answeredBy(mark) === null ? stateOf(mark) : "answered";
}

/** Where a highlight falls in the state filter. */
export function filterOf(h: Highlight): StateFilter {
  return isPrivate(h) ? "private" : stateOf(h);
}

/**
 * Of the highlights not found in the document's current text, those shown
 * above it at once (docs/design/marks.md): notes still in the loop, or with
 * replies the user hasn't seen. Resolved notes and bare highlights wait
 * behind "N more", so the strip doesn't grow with every old mark.
 */
export function unplacedFirst(h: Highlight): boolean {
  if (newReplies(h).length > 0) return true;
  return (h.note !== null || h.private === false) && stateOf(h) !== "resolved";
}

/** Where a document's note falls in the state filter. */
export function noteFilterOf(note: DocumentNote, status: string | null | undefined): StateFilter {
  return sendableNote(note, status) === null ? "private" : stateOf(note);
}

/** A document's feedback by state, for its row in the Marks view: "3 unsent · 2 sent · 1 answered · 1 addressed". */
export function feedbackSummary(
  highlights: readonly Highlight[],
  note: DocumentNote | undefined,
  status: string | null | undefined,
): string {
  const counts: Record<Exclude<NoteIconKind, "private">, number> = { open: 0, sent: 0, answered: 0, addressed: 0, resolved: 0 };
  for (const h of highlights) if (!isPrivate(h)) counts[loopKind(h)]++;
  if (note !== undefined && sendableNote(note, status) !== null) counts[loopKind(note)]++;
  return [
    counts.open > 0 && `${counts.open} unsent`,
    counts.sent > 0 && `${counts.sent} sent`,
    counts.answered > 0 && `${counts.answered} answered`,
    counts.addressed > 0 && `${counts.addressed} addressed`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const TIME = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The latest round that sent a highlight (null: the note on the document as a whole). */
function lastRound(rounds: readonly Round[] | undefined, highlightId: string | null): Round | undefined {
  return [...(rounds ?? [])]
    .reverse()
    .find((r) => (highlightId === null ? r.documentNote === true : r.notes.includes(highlightId)));
}

/** When a highlight (null: the note on the document as a whole) was last sent, from the rounds that list it. */
export function lastSent(rounds: readonly Round[] | undefined, highlightId: string | null): string | null {
  const round = lastRound(rounds, highlightId);
  return round === undefined ? null : TIME.format(new Date(round.at));
}

/**
 * The agent working on a sent note ("Claude Code"): it took the round that
 * last sent it, from a review loop or by fetching it. Null while the notes
 * wait for it, or when they were copied.
 */
export function pickedUpBy(rounds: readonly Round[] | undefined, highlightId: string | null): string | null {
  const round = lastRound(rounds, highlightId);
  if (round === undefined || round.client === undefined) return null;
  return round.via === "mcp" || round.picked !== undefined ? round.client : null;
}

/**
 * Where a note is in the review loop, in a sentence: "Sent Nov 11, 10:02 ·
 * waiting for the agent", or "… · Claude Code is working on it" once
 * `pickedBy` took it. For an answered note, `pickedBy` is the agent that answered.
 */
export function loopSentence(kind: NoteIconKind, sent: string | null = null, pickedBy: string | null = null): string {
  switch (kind) {
    case "private":
      return "Private: only you see it, never sent";
    case "open":
      return "Not sent yet";
    case "sent":
      return `Sent${sent === null ? "" : ` ${sent}`} · ${pickedBy === null ? "waiting for the agent" : `${pickedBy} is working on it`}`;
    case "answered":
      return `Answered by ${pickedBy ?? "the agent"} · reply or resolve it`;
    case "addressed":
      return "Addressed by the agent · resolve or reopen it";
    case "resolved":
      return "Resolved";
  }
}

/** Whether a note waits on the user: not sent yet, answered and to be replied to, or addressed and to be checked. */
export function needsYou(kind: NoteIconKind): boolean {
  return kind === "open" || kind === "answered" || kind === "addressed";
}

// ─── The Send dialog ─────────────────────────────────────────────────────────

/** A document offered in the Send dialog, with its source and marks. */
export interface SendSource {
  doc: DocumentMeta;
  source: string;
  highlights: readonly Highlight[];
  note?: DocumentNote | undefined;
  /** Highlights known not to be in the current text (the open document's). */
  unplaced?: ReadonlySet<string> | undefined;
}

/** A note that can be ticked: a highlight, or (highlight null) the note on the document as a whole. */
export interface SendItem {
  key: string;
  docId: string;
  highlight: Highlight | null;
  /** For the document's note: the part that's sent. */
  note: DocumentNote | null;
  state: NoteState;
}

export interface SendGroup {
  doc: DocumentMeta;
  source: string;
  /** Not sent yet: the document's note first, then highlights in text order. */
  items: SendItem[];
  /** Sent before, answered or not: offered unticked. */
  sentBefore: SendItem[];
  /** Counted, not listed. */
  privateCount: number;
  unplacedCount: number;
}

export const noteKey = (docId: string) => `n:${docId}`;
export const highlightKey = (docId: string, highlightId: string) => `h:${docId}:${highlightId}`;

/** The documents' notes as the Send dialog lists them; documents with nothing to list or count are left out. */
export function sendGroups(sources: readonly SendSource[]): SendGroup[] {
  return sources.flatMap(({ doc, source, highlights, note, unplaced }) => {
    const items: SendItem[] = [];
    const sentBefore: SendItem[] = [];
    let privateCount = 0;
    let unplacedCount = 0;
    const offer = (item: SendItem) => {
      if (item.state === "open") items.push(item);
      else if (item.state === "sent") sentBefore.push(item);
      // Addressed and resolved notes are reopened to be sent again
    };

    const sendable = sendableNote(note, doc.meta?.status);
    // A locked comment; its status change, if any, is still offered
    if (note?.private === true && note.text !== null) privateCount++;
    if (sendable !== null) {
      offer({ key: noteKey(doc.id), docId: doc.id, highlight: null, note: sendable, state: stateOf(sendable) });
    }
    for (const h of [...highlights].sort((a, b) => a.position.start - b.position.start)) {
      if (isPrivate(h)) privateCount++;
      else if (unplaced?.has(h.id) === true) unplacedCount++;
      else offer({ key: highlightKey(doc.id, h.id), docId: doc.id, highlight: h, note: null, state: stateOf(h) });
    }
    return items.length + sentBefore.length + privateCount + unplacedCount === 0
      ? []
      : [{ doc, source, items, sentBefore, privateCount, unplacedCount }];
  });
}

/** What's ticked when the dialog opens: every note not sent yet. */
export function defaultSelection(groups: readonly SendGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.items.map((item) => item.key)));
}

/** The ticked notes of one document: its highlights and (if ticked) its note. */
export interface Picked {
  group: SendGroup;
  highlights: Highlight[];
  note: DocumentNote | undefined;
}

/** The ticked notes, by document, in the dialog's order; documents with none ticked are left out. */
export function picked(groups: readonly SendGroup[], selected: ReadonlySet<string>): Picked[] {
  return groups.flatMap((group) => {
    const ticked = [...group.items, ...group.sentBefore].filter((item) => selected.has(item.key));
    if (ticked.length === 0) return [];
    const highlights = ticked
      .flatMap((item) => (item.highlight === null ? [] : [item.highlight]))
      .sort((a, b) => a.position.start - b.position.start);
    const note = ticked.find((item) => item.highlight === null)?.note ?? undefined;
    return [{ group, highlights, note }];
  });
}

/** The send to record for the ticked notes. */
export function sendDocuments(picks: readonly Picked[]): SendDocument[] {
  return picks.map(({ group, highlights, note }) => ({
    docId: group.doc.id,
    highlightIds: highlights.map((h) => h.id),
    documentNote: note !== undefined,
  }));
}
