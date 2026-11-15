/**
 * NoteThread.tsx — The replies under a note, each with its author and time,
 * and a box for the user's own (docs/design/agent-integration.md). Shown in
 * a highlight's popover and the note on the document. Once a note has
 * replies, it's the thread's first message and scrolls with them: what was
 * answered can't be edited. Only the user's latest reply can, until someone
 * answers it, and deleted, until it's sent.
 *
 * Messages are light Markdown (MessageText.tsx): formatting only, never
 * HTML, links that open or images that load.
 */

import { useState } from "react";
import { authorName, newReplies, replyTime } from "../threads";
import type { Author, NoteState, Thread } from "../types";
import MessageText from "./MessageText";
import styles from "./NoteThread.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const SEND_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const SEND_NOW_SHORTCUT = IS_MAC ? "⇧⌘↩" : "Ctrl+Shift+Enter";

interface NoteThreadProps {
  thread: Thread & { state?: NoteState | undefined };
  /** The note itself, shown as the first message (when it has replies). */
  note?: { text: string; author?: Author | undefined; at: string } | undefined;
  /** Send the user's reply. */
  onReply: (text: string) => void;
  /** Change the user's latest reply. */
  onEditReply: (replyId: string, text: string) => void;
  /** Delete the user's latest reply: the note goes back to its state before it. */
  onDeleteReply: (replyId: string) => void;
  /** Whether the reply box is open: the popover keeps Escape for it while it is. */
  onWritingChange?: (writing: boolean) => void;
  /** The agents in a review loop on the document ("Claude Code"): the reply box offers Save and Send. */
  sendTo?: string | null | undefined;
  /** Save a new reply (replyId null) or the edit of the latest, and send the note to `sendTo` on its own. */
  onSaveAndSend?: ((reply: { text: string; replyId: string | null }) => void) | undefined;
}

export default function NoteThread({
  thread,
  note,
  onReply,
  onEditReply,
  onDeleteReply,
  onWritingChange,
  sendTo = null,
  onSaveAndSend,
}: NoteThreadProps): React.ReactElement | null {
  // A new reply (replyId null), or the user's latest one being edited
  const [draft, setDraft] = useState<{ text: string; replyId: string | null } | null>(null);
  const replies = thread.replies ?? [];
  // Captured when shown, so the replies stay marked new while the thread is open
  const [fresh] = useState(() => new Set(newReplies(thread).map((r) => r.id)));
  // The store refuses an edit once someone has answered, so only the last reply offers it
  const last = replies[replies.length - 1];
  const editable = last?.author.kind === "user" ? last.id : null;
  // Open: not sent yet, so the agent hasn't seen it
  const deletable = (thread.state ?? "open") === "open";

  const write = (next: { text: string; replyId: string | null } | null) => {
    setDraft(next);
    onWritingChange?.(next !== null);
  };
  const send = () => {
    const text = draft?.text.trim() ?? "";
    if (draft !== null && text !== "") {
      if (draft.replyId === null) onReply(text);
      else if (text !== replies.find((r) => r.id === draft.replyId)?.text) onEditReply(draft.replyId, text);
    }
    write(null);
  };
  // Save and Send: with an agent in a loop on the document, the reply goes
  // to it at once instead of with the next round
  const canSend = sendTo !== null && onSaveAndSend !== undefined;
  const saveAndSend = () => {
    const text = draft?.text.trim() ?? "";
    if (!canSend || draft === null || text === "") return;
    onSaveAndSend({ text, replyId: draft.replyId });
    write(null);
  };

  const editor = (editing: boolean) =>
    draft === null ? null : (
      <div className={styles.editor}>
        <textarea
          className={styles.field}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            // Its own keys: not the note editor's around it (⌘↩ saves and closes that)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey && canSend) {
              e.preventDefault();
              e.stopPropagation();
              saveAndSend();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              send();
            } else if (e.key === "Escape") {
              // Cancel the reply, keep the popover
              e.stopPropagation();
              write(null);
            }
          }}
          onFocus={(e) => {
            // Editing: the cursor at the end of the reply
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          aria-label={editing ? "Edit reply" : "Reply"}
          placeholder="Reply… it goes with the next round"
          rows={3}
          maxLength={10_000}
          autoFocus
        />
        <div className={styles.actions}>
          <span className={styles.hint}>
            {SEND_SHORTCUT} to {editing || canSend ? "save" : "send"} · Esc to cancel
          </span>
          {canSend && (
            <button
              type="button"
              className={styles.sendNowBtn}
              onClick={saveAndSend}
              disabled={draft.text.trim() === ""}
              title={`Save, and send this note to ${sendTo} (${SEND_NOW_SHORTCUT})`}
            >
              Save and Send
            </button>
          )}
          <button type="button" className={styles.sendBtn} onClick={send} disabled={draft.text.trim() === ""}>
            {editing || canSend ? "Save" : "Send"}
          </button>
        </div>
      </div>
    );

  return (
    <div className={styles.thread}>
      {(note !== undefined || replies.length > 0) && (
        <ol className={styles.replies} aria-label="Replies">
          {note !== undefined && (
            <li className={`${styles.reply} ${(note.author?.kind ?? "user") === "user" ? styles.mine : ""}`}>
              <div className={styles.byline}>
                <span className={styles.author}>{authorName(note.author ?? { kind: "user" })}</span>
                <time dateTime={note.at} title={new Date(note.at).toLocaleString()}>
                  {replyTime(note.at)}
                </time>
              </div>
              <MessageText text={note.text} />
            </li>
          )}
          {replies.map((reply) => (
            <li key={reply.id} className={`${styles.reply} ${reply.author.kind === "user" ? styles.mine : ""}`}>
              <div className={styles.byline}>
                <span className={styles.author}>{authorName(reply.author)}</span>
                <time dateTime={reply.at} title={new Date(reply.at).toLocaleString()}>
                  {replyTime(reply.at)}
                </time>
                {fresh.has(reply.id) && (
                  <span className={styles.new} aria-label="New">
                    New
                  </span>
                )}
                {reply.id === editable && draft === null && (
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => write({ text: reply.text, replyId: reply.id })}
                    aria-label="Edit reply"
                    title="Edit your reply: it goes with the next round"
                  >
                    Edit
                  </button>
                )}
                {reply.id === editable && deletable && draft === null && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => onDeleteReply(reply.id)}
                    aria-label="Delete reply"
                    title="Delete your reply: it hasn't been sent"
                  >
                    Delete
                  </button>
                )}
              </div>
              {draft !== null && draft.replyId === reply.id ? editor(true) : <MessageText text={reply.text} />}
            </li>
          ))}
        </ol>
      )}

      {draft === null ? (
        <button type="button" className={styles.replyBtn} onClick={() => write({ text: "", replyId: null })}>
          Reply
        </button>
      ) : (
        draft.replyId === null && editor(false)
      )}
    </div>
  );
}
