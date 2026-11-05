import React, { useId } from "react";
import styles from "./FindBar.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const NEXT_SHORTCUT = IS_MAC ? "Enter, ⌘G" : "Enter, F3";
const PREVIOUS_SHORTCUT = IS_MAC ? "⇧Enter, ⇧⌘G" : "Shift+Enter, Shift+F3";

interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** 0-based index of the current match, or -1 when none is selected yet. */
  current: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

/**
 * Find in the open document (⌘F / Ctrl+F), modelled on VS Code's find
 * widget: a query box, "3 of 12", previous / next and close.
 */
export default function FindBar({
  query,
  onQueryChange,
  current,
  total,
  onNext,
  onPrevious,
  onClose,
  inputRef,
}: FindBarProps): React.ReactElement {
  const countId = useId();
  const count =
    query === "" ? "" : total === 0 ? "No results" : current < 0 ? `${total} found` : `${current + 1} of ${total}`;

  return (
    <div className={styles.bar} role="search" aria-label="Find in document">
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        placeholder="Find in document"
        aria-label="Find in document"
        aria-describedby={countId}
        value={query}
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span id={countId} className={`${styles.count} ${query !== "" && total === 0 ? styles.noResults : ""}`} aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        className={styles.btn}
        onClick={onPrevious}
        disabled={total === 0}
        aria-label={`Previous match (${PREVIOUS_SHORTCUT})`}
        title={`Previous match (${PREVIOUS_SHORTCUT})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M8 13V3.5M3.5 8L8 3.5 12.5 8" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onNext}
        disabled={total === 0}
        aria-label={`Next match (${NEXT_SHORTCUT})`}
        title={`Next match (${NEXT_SHORTCUT})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M8 3v9.5M3.5 8L8 12.5 12.5 8" strokeWidth="1.2" />
        </svg>
      </button>
      <button type="button" className={styles.btn} onClick={onClose} aria-label="Close (Escape)" title="Close (Escape)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
