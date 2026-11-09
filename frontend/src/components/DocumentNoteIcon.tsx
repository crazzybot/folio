import React from "react";

/** A note on the document as a whole: a page with lines (a highlight's note is a speech bubble). */
export default function DocumentNoteIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3" />
    </svg>
  );
}
