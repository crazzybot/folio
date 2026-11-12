/**
 * noteIcons.ts — The note icon for each place in the review loop
 * (notes/01a-sending-notes.md §2). The highlight's colour belongs to the
 * user, so state is told by shape: what needs the user (unsent, addressed)
 * is solid or checked, what's waiting (sent) has an arrow, what's done
 * (resolved) is faded, and a private note keeps the plain outline.
 *
 * Paths for a 16×16 view box, stroked in currentColor; shared by the margin
 * markers (React) and the inline notes (built as DOM in inlineNotes.ts).
 */

import type { NoteState } from "./types";

/** A note's icon: its state, or private (out of the loop). */
export type NoteIconKind = NoteState | "private";

// A speech bubble, and a smaller one with room for an arrow beside it
const BUBBLE = "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z";
const SMALL_BUBBLE = "M1.5 5.5h8.5v5.5h-4.5l-2.5 2v-2h-1.5z";

interface IconPath {
  d: string;
  fill?: boolean;
}

export const NOTE_ICON_PATHS: Readonly<Record<NoteIconKind, readonly IconPath[]>> = {
  private: [{ d: BUBBLE }],
  open: [{ d: BUBBLE, fill: true }],
  sent: [{ d: SMALL_BUBBLE }, { d: "M10 3.5h4.5M12.8 1.8l1.7 1.7-1.7 1.7" }],
  addressed: [{ d: BUBBLE }, { d: "M5.5 7l1.5 1.5 3-3" }],
  resolved: [{ d: BUBBLE }, { d: "M5.5 7l1.5 1.5 3-3" }],
};

export const NOTE_ICON_LABELS: Readonly<Record<NoteIconKind, string>> = {
  private: "Private note",
  open: "Not sent",
  sent: "Sent",
  addressed: "Addressed",
  resolved: "Resolved",
};

/** The icon as SVG markup, for elements built outside React. Only the fixed paths above go in. */
export function noteIconMarkup(kind: NoteIconKind, size = 12): string {
  const paths = NOTE_ICON_PATHS[kind]
    .map((p) => `<path d="${p.d}"${p.fill === true ? ' fill="currentColor"' : ""}/>`)
    .join("");
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${paths}</svg>`
  );
}
