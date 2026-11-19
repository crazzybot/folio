import React from "react";

/** A note on the document as a whole: a page with a speech bubble (a highlight's note is the bubble alone). */
export default function DocumentNoteIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 6.5v-2l-3-3h-6v13h3.5M8.5 1.5v3h3M4.5 5h2.5M4.5 7.5h1.5" />
      <path d="M7.5 8.5h7v4.5h-3.5l-2 1.5v-1.5h-1.5z" />
    </svg>
  );
}
