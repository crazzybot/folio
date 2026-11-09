import React, { useEffect, useId, useRef, useState } from "react";
import type { ReviewNotes } from "../reviewNotes";
import styles from "./ReviewNotesPanel.module.css";

const IS_MAC = window.markdownApi?.platform === "darwin" || navigator.platform.toUpperCase().includes("MAC");

/**
 * Write `text` to the clipboard. False when the page can't: a self-hosted
 * server on plain HTTP isn't a secure context, so it has no clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!window.isSecureContext || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A clipboard with lines of notes: the Copy review notes buttons. */
export function ReviewNotesIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 2.5h-2v12h9v-12h-2" />
      <rect x="5.5" y="1.5" width="5" height="2" rx="0.5" />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" strokeLinecap="round" />
    </svg>
  );
}

interface ReviewNotesPanelProps {
  /** What's being copied: the file name, or "3 documents". */
  title: string;
  notes: ReviewNotes;
  onClose: () => void;
  /** Go to a note's highlight (the panel closes). */
  onOpenNote: (docId: string, highlightId: string) => void;
  /** Show the highlights left out as out of date (the Marks view). */
  onShowLeftOut?: () => void;
}

// How long the check shows before the panel closes
const COPIED_MS = 600;

/**
 * Copy review notes: the exact text that will be pasted into a coding agent,
 * read-only, with a summary of what's in it (docs/design/review-notes.md).
 * Copy has focus, so Enter copies and closes; Escape closes without copying.
 * Clicking a note goes to its highlight. Where the page has no clipboard,
 * Copy selects the text for ⌘C instead.
 */
export default function ReviewNotesPanel({ title, notes, onClose, onOpenNote, onShowLeftOut }: ReviewNotesPanelProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");

  // Focus Copy; give focus back to what opened the panel on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    copyRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(onClose, COPIED_MS);
    return () => clearTimeout(timer);
  }, [status, onClose]);

  const copy = () => {
    void copyText(notes.text).then((ok) => {
      if (ok) {
        setStatus("copied");
        return;
      }
      // No clipboard: select the text for the user to copy
      const pre = textRef.current;
      const selection = window.getSelection();
      if (pre !== null && selection !== null) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setStatus("manual");
    });
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Keep Tab inside the dialog
    if (e.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button") ?? [])].filter(
      (el) => !el.hasAttribute("disabled"),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  // The text as runs of lines: a note's lines (clickable) or the lines between
  const lines = notes.text.split("\n");
  const runs: { note?: (typeof notes.notes)[number]; text: string }[] = [];
  let at = 0;
  for (const note of notes.notes) {
    if (note.lines.start > at) runs.push({ text: lines.slice(at, note.lines.start).join("\n") + "\n" });
    runs.push({ note, text: lines.slice(note.lines.start, note.lines.end).join("\n") + "\n" });
    at = note.lines.end;
  }
  if (at < lines.length) runs.push({ text: lines.slice(at).join("\n") });

  const count = notes.notes.length;
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Review notes <span className={styles.subject}>· {title}</span>
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close (Escape)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.3" />
            </svg>
          </button>
        </header>

        <p className={styles.summary}>
          {[
            notes.documentNotes > 0 &&
              `${notes.documentNotes} note${notes.documentNotes !== 1 ? "s" : ""} on the document${notes.documentNotes !== 1 ? "s" : ""}`,
            (count > 0 || notes.documentNotes === 0) && `${count} note${count !== 1 ? "s" : ""} on passages`,
          ]
            .filter(Boolean)
            .join(" · ")}
          {notes.withoutLine > 0 && (
            <span title="Not found in the Markdown source, so copied with the quote and note but no line number">
              {" "}
              · {notes.withoutLine} without a line number
            </span>
          )}
          {notes.requestsDone > 0 && (
            <span title="The document already has the status the note asks for">
              {" "}
              · {notes.requestsDone} status change{notes.requestsDone !== 1 ? "s" : ""} already made, left out
            </span>
          )}
          {notes.leftOut > 0 && (
            <>
              {" "}
              ·{" "}
              {onShowLeftOut ? (
                <button type="button" className={styles.linkBtn} onClick={onShowLeftOut} title="Show them in the Marks view">
                  {notes.leftOut} out of date, left out
                </button>
              ) : (
                <span>{notes.leftOut} out of date, left out</span>
              )}
            </>
          )}
        </p>

        <pre ref={textRef} className={styles.text} aria-label="Text to copy">
          {runs.map((run, i) =>
            run.note === undefined ? (
              <span key={i}>{run.text}</span>
            ) : (
              // A span, not a button: Chromium won't select a button's text,
              // and the text must stay selectable for ⌘C. Keyboard users
              // reach highlights from the Marks view.
              <span
                key={i}
                className={styles.note}
                onClick={() => run.note && onOpenNote(run.note.docId, run.note.highlightId)}
                title="Go to this highlight"
              >
                {run.text}
              </span>
            ),
          )}
        </pre>

        <footer className={styles.footer}>
          {status === "manual" && (
            <span className={styles.hint} role="status">
              Press {IS_MAC ? "⌘C" : "Ctrl+C"} to copy
            </span>
          )}
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button ref={copyRef} type="button" className={styles.primaryBtn} onClick={copy} disabled={count === 0}>
            {status === "copied" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M3 8.5l3.5 3.5L13 4.5" />
                </svg>
                Copied
              </>
            ) : (
              "Copy"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
