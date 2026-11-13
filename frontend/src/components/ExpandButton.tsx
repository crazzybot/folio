import React from "react";
import styles from "./ExpandButton.module.css";

/**
 * The "open in full window" button in the top-right corner of a diagram or
 * image. Shown while its parent is hovered, or when it has focus; the parent
 * must be positioned.
 */
export default function ExpandButton({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.expandBtn}
      onClick={onClick}
      aria-label={label}
      title="Open in full window (or double-click)"
    >
      {/* Arrows to the corners */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
      </svg>
    </button>
  );
}
