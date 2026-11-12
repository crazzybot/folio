import React from "react";
import { NOTE_ICON_PATHS } from "../noteIcons";
import type { NoteIconKind } from "../noteIcons";
import { needsYou } from "../sending";
import styles from "./NoteStateIcon.module.css";

/** A note's icon for its place in the review loop (noteIcons.ts): in the accent colour while it waits on the user. */
export default function NoteStateIcon({ kind, size = 14 }: { kind: NoteIconKind; size?: number }): React.ReactElement {
  return (
    <svg
      className={needsYou(kind) ? styles.needsYou : kind === "resolved" ? styles.done : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {NOTE_ICON_PATHS[kind].map((p) => (
        <path key={p.d} d={p.d} fill={p.fill === true ? "currentColor" : "none"} />
      ))}
    </svg>
  );
}
