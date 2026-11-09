import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NoteChanges } from "../dataSource";
import { KNOWN_STATUSES, normaliseStatus } from "../status";
import type { DocumentNote } from "../types";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentNoteEditor.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const SAVE_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const WIDTH = 320;
const MARGIN = 8;
// The status select's values besides the statuses themselves
const NO_CHANGE = "";
const OTHER = "\u0000other";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface DocumentNoteEditorProps {
  /** The toolbar button it opens under (viewport pixels). */
  anchor: { right: number; bottom: number };
  /** The document's status now, if it has one: not offered as a change. */
  currentStatus: string | null;
  note: DocumentNote | undefined;
  /** Statuses used in the workspace, offered after the known ones. */
  workspaceStatuses: readonly string[];
  onSave: (changes: NoteChanges) => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * The note on the document as a whole (document-notes.md): a status to ask
 * for and a comment. As the highlight note editor: ⌘↩ / Ctrl+Enter saves,
 * Esc cancels, clicking elsewhere saves what changed.
 */
export default function DocumentNoteEditor({
  anchor,
  currentStatus,
  note,
  workspaceStatuses,
  onSave,
  onRemove,
  onClose,
}: DocumentNoteEditorProps): React.ReactElement {
  const statuses = [
    ...KNOWN_STATUSES,
    ...workspaceStatuses.filter((s) => !(KNOWN_STATUSES as readonly string[]).includes(s)).sort(),
  ].filter((s) => s !== currentStatus || normaliseStatus(note?.requestedStatus ?? "") === s);
  const requested = note?.requestedStatus ?? null;
  const [choice, setChoice] = useState(
    requested === null ? NO_CHANGE : statuses.includes(requested) ? requested : OTHER,
  );
  const [other, setOther] = useState(requested !== null && !statuses.includes(requested) ? requested : "");
  const [text, setText] = useState(note?.text ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const changes = (): NoteChanges => ({
    requestedStatus: choice === NO_CHANGE ? null : choice === OTHER ? other.trim() || null : choice,
    text: text.trim() === "" ? null : text,
  });
  const dirty = () => {
    const next = changes();
    return next.requestedStatus !== (note?.requestedStatus ?? null) || next.text !== (note?.text ?? null);
  };
  const save = () => {
    if (dirty()) onSave(changes());
    onClose();
  };

  // Clicking elsewhere saves what changed, as a highlight's note does
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) saveRef.current();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const shownStatus = choice === OTHER ? normaliseStatus(other) : choice;

  return createPortal(
    <div
      ref={rootRef}
      className={styles.editor}
      role="dialog"
      aria-label="Note on this document"
      style={{
        top: anchor.bottom + 6,
        left: Math.max(MARGIN, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - MARGIN)),
        width: WIDTH,
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.heading}>Note on this document</div>

      <label className={styles.label} htmlFor={`${id}-status`}>
        Status
      </label>
      <div className={styles.statusRow}>
        <span className={styles.statusIcon} aria-hidden="true">
          {shownStatus !== "" && <StatusIcon status={shownStatus} />}
        </span>
        <span className={styles.selectWrap}>
        <select
          id={`${id}-status`}
          className={styles.select}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          autoFocus
        >
          <option value={NO_CHANGE}>No change{currentStatus === null ? "" : ` (now ${currentStatus})`}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {capitalise(s)}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
        {/* Our own arrow: the native one hugs the border and differs by platform */}
        <svg className={styles.selectArrow} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeWidth="1.2" />
        </svg>
        </span>
      </div>
      {choice === OTHER && (
        <input
          className={styles.input}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Status, e.g. approved"
          aria-label="Other status"
          maxLength={40}
          autoFocus
        />
      )}

      <label className={styles.label} htmlFor={`${id}-text`}>
        Comment
      </label>
      <textarea
        id={`${id}-text`}
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your overall comment…"
        rows={4}
        maxLength={10_000}
      />

      <div className={styles.actions}>
        <span className={styles.hint}>{SAVE_SHORTCUT} to save · Esc to cancel</span>
        {note !== undefined && (
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove
          </button>
        )}
        <button type="button" className={styles.saveBtn} onClick={save}>
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}
