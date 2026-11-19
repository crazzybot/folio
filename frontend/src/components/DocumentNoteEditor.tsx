import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NoteChanges } from "../dataSource";
import { answeredBy, UNRESOLVE_TITLE } from "../sending";
import { KNOWN_STATUSES, normaliseStatus, statusNew } from "../status";
import { canReply, newReplies } from "../threads";
import type { DocumentNote, NoteState } from "../types";
import LockIcon from "./LockIcon";
import NoteStateIcon from "./NoteStateIcon";
import NoteThread from "./NoteThread";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentNoteEditor.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const SAVE_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const SEND_SHORTCUT = IS_MAC ? "⇧⌘↩" : "Ctrl+Shift+Enter";
// As a highlight's popover with a note (MarksLayer.module.css .popoverWide)
const WIDTH = 420;
const MARGIN = 8;
// The status select's values besides the statuses themselves
const NO_CHANGE = "";
const OTHER = "\u0000other";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type NoteEditorAnchor = { bottom: number } & ({ right: number } | { left: number });

interface DocumentNoteEditorProps {
  /** What it opens under (viewport pixels): right-aligned with the toolbar button, left-aligned with the status in the document. */
  anchor: NoteEditorAnchor;
  /** The document's status now, if it has one: not offered as a change. */
  currentStatus: string | null;
  note: DocumentNote | undefined;
  /** Statuses used in the workspace, offered after the known ones. */
  workspaceStatuses: readonly string[];
  onSave: (changes: NoteChanges) => void;
  /** The agents in a review loop on the document ("Claude Code"): Save and Send is offered. */
  sendTo?: string | null;
  /** Save what changed (null: nothing) and send the note to `sendTo` on its own. */
  onSaveAndSend?: (changes: NoteChanges | null) => void;
  /** Save the user's reply (replyId null: a new one) and send the note to `sendTo` on its own. */
  onReplyAndSend?: (reply: { text: string; replyId: string | null }) => void;
  /** The agent working on the sent note ("Claude Code"): it took it. Null while it waits. */
  pickedBy?: string | null;
  onRemove: () => void;
  /** Change where the note is in the review loop (docs/design/sending-notes.md). */
  onSetState: (state: NoteState) => void;
  /** The user's reply to the note, and that they saw its thread (docs/design/agent-integration.md). */
  onReply: (text: string) => void;
  onEditReply: (replyId: string, text: string) => void;
  onDeleteReply: (replyId: string) => void;
  /** The note was opened with new replies, or with the status it asked for newly reached. */
  onSeen: () => void;
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
  sendTo = null,
  onSaveAndSend,
  onReplyAndSend,
  pickedBy = null,
  onRemove,
  onSetState,
  onReply,
  onEditReply,
  onDeleteReply,
  onSeen,
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
  // Replied to: the comment is part of the conversation, and stays as it was answered
  const answered = (note?.replies?.length ?? 0) > 0;
  // Only me: the comment stays out of the loop; a status change is still sent
  const [locked, setLocked] = useState(note?.private === true);
  // Writing a reply: its box has its own buttons, so the note's step aside
  const [replying, setReplying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const changes = (): NoteChanges => ({
    requestedStatus: choice === NO_CHANGE ? null : choice === OTHER ? other.trim() || null : choice,
    text: text.trim() === "" ? null : text,
    private: locked ? true : null,
  });
  const dirty = () => {
    const next = changes();
    return (
      next.requestedStatus !== (note?.requestedStatus ?? null) ||
      next.text !== (note?.text ?? null) ||
      locked !== (note?.private === true)
    );
  };
  const state = note?.state ?? "open";
  const answerer = note === undefined ? null : answeredBy(note);
  const setState = (next: NoteState) => {
    onSetState(next);
    onClose();
  };
  const save = () => {
    if (dirty()) onSave(changes());
    onClose();
  };
  // Not for a private note, which is never sent, or before there's a note
  const canSend = sendTo !== null && onSaveAndSend !== undefined && note?.private !== true;
  // Save waits for a change: a status, the comment or Only me
  const changed = dirty();
  // Save and Send also sends a saved note that hasn't gone yet
  const unsent = changed || (note !== undefined && state === "open");
  const saveAndSend = () => {
    if (!canSend || !unsent) return;
    onSaveAndSend(dirty() ? changes() : null);
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

  // Narrower in a narrow window, with its margin on both sides
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);

  const shownStatus = choice === OTHER ? normaliseStatus(other) : choice;

  // Opening the note shows its new replies, and the status it asked for:
  // they're seen from then on (the header's New goes)
  const fresh = note === undefined ? 0 : newReplies(note).length;
  const reached = statusNew(currentStatus, note);
  useEffect(() => {
    if (fresh > 0 || reached) onSeen();
  }, [fresh, reached, onSeen]);

  return createPortal(
    <div
      ref={rootRef}
      className={styles.editor}
      role="dialog"
      aria-label="Note on this document"
      style={{
        top: anchor.bottom + 6,
        left: Math.max(
          MARGIN,
          Math.min("left" in anchor ? anchor.left : anchor.right - width, window.innerWidth - width - MARGIN),
        ),
        width,
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey && canSend) {
          e.preventDefault();
          saveAndSend();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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

      {/* Answered: the comment is the thread's first message, no longer editable */}
      {!answered && (
        <>
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
        </>
      )}

      {/* The thread: the saved note's replies, or a reply to an imported note */}
      {note !== undefined && ((note.replies?.length ?? 0) > 0 || (!locked && canReply(note))) && (
        <div className={styles.thread}>
          <NoteThread
            thread={note}
            note={answered && note.text !== null ? { text: note.text, author: note.author, at: note.created } : undefined}
            onReply={onReply}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            onWritingChange={setReplying}
            sendTo={note.private === true ? null : sendTo}
            onSaveAndSend={
              onReplyAndSend === undefined
                ? undefined
                : (reply) => {
                    onReplyAndSend(reply);
                    onClose();
                  }
            }
          />
        </div>
      )}

      {!replying && (
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
          {canSend && (
            <button
              type="button"
              className={styles.removeBtn}
              onClick={saveAndSend}
              disabled={!unsent}
              title={`Save, and send this note to ${sendTo} (${SEND_SHORTCUT})`}
            >
              Save and Send
            </button>
          )}
          <button type="button" className={styles.saveBtn} onClick={save} disabled={!changed}>
            Save
          </button>
        </div>
      )}

      {/* The last row, as a highlight's: where the note is in the review loop, and the lock */}
      <div className={styles.loopRow}>
        <span className={styles.loopStatus}>
          {/* Only once saved: a new note isn't anything yet */}
          {!locked && note !== undefined && state === "open" && (
            <>
              <NoteStateIcon kind="open" size={12} /> Not sent
            </>
          )}
          {!locked && answerer !== null && (
            <>
              <NoteStateIcon kind="answered" size={12} /> Answered by {answerer} ·{" "}
              <button type="button" className={styles.loopBtn} onClick={() => setState("resolved")}>
                Resolve
              </button>
            </>
          )}
          {!locked && state === "sent" && answerer === null && (
            <>
              <NoteStateIcon kind="sent" size={12} /> Sent{pickedBy === null ? "" : ` · ${pickedBy} has it`} ·{" "}
              <button type="button" className={styles.loopBtn} onClick={() => setState("open")}>
                Mark not sent
              </button>{" "}
              ·{" "}
              <button type="button" className={styles.loopBtn} onClick={() => setState("resolved")}>
                Resolve
              </button>
            </>
          )}
          {!locked && state === "addressed" && (
            <>
              <NoteStateIcon kind="addressed" size={12} /> Addressed ·{" "}
              <button type="button" className={styles.loopBtn} onClick={() => setState("resolved")}>
                Resolve
              </button>
            </>
          )}
          {!locked && state === "resolved" && (
            <>
              <NoteStateIcon kind="resolved" size={12} /> Resolved ·{" "}
              <button
                type="button"
                className={styles.loopBtn}
                onClick={() => setState(note?.resolvedFrom ?? "open")}
                title={UNRESOLVE_TITLE}
              >
                Unresolve
              </button>
            </>
          )}
        </span>
        <button
          type="button"
          className={`${styles.lock} ${locked ? styles.lockOn : ""}`}
          onClick={() => setLocked(!locked)}
          aria-pressed={locked}
          title={locked ? "Only you see the comment: click to send it with the others" : "Keep the comment to yourself: it's never sent; a status change still is"}
        >
          <LockIcon locked={locked} /> Only me
        </button>
      </div>
    </div>,
    document.body,
  );
}
