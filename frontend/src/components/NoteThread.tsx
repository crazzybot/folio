/**
 * NoteThread.tsx — The replies under a note, each with its author and time,
 * and a box for the user's own (docs/design/agent-integration.md). Shown in
 * a highlight's popover and the note on the document. The user's latest
 * reply can be edited until someone answers it.
 *
 * Replies are plain text, as notes are: an agent's reply is shown, never
 * rendered as Markdown or HTML.
 */

import { useState } from "react";
import { authorName, newReplies, replyTime } from "../threads";
import type { Thread } from "../types";
import styles from "./NoteThread.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const SEND_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";

interface NoteThreadProps {
  thread: Thread;
  /** Send the user's reply. */
  onReply: (text: string) => void;
  /** Change the user's latest reply. */
  onEditReply: (replyId: string, text: string) => void;
  /** Whether the reply box is open: the popover keeps Escape for it while it is. */
  onWritingChange?: (writing: boolean) => void;
}

export default function NoteThread({ thread, onReply, onEditReply, onWritingChange }: NoteThreadProps): React.ReactElement | null {
  // A new reply (replyId null), or the user's latest one being edited
  const [draft, setDraft] = useState<{ text: string; replyId: string | null } | null>(null);
  const replies = thread.replies ?? [];
  // Captured when shown, so the replies stay marked new while the thread is open
  const [fresh] = useState(() => new Set(newReplies(thread).map((r) => r.id)));
  // The store refuses an edit once someone has answered, so only the last reply offers it
  const last = replies[replies.length - 1];
  const editable = last?.author.kind === "user" ? last.id : null;

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

  const editor = (editing: boolean) =>
    draft === null ? null : (
      <div className={styles.editor}>
        <textarea
          className={styles.field}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            // Its own keys: not the note editor's around it (⌘↩ saves and closes that)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
            {SEND_SHORTCUT} to {editing ? "save" : "send"} · Esc to cancel
          </span>
          <button type="button" className={styles.sendBtn} onClick={send} disabled={draft.text.trim() === ""}>
            {editing ? "Save" : "Send"}
          </button>
        </div>
      </div>
    );

  return (
    <div className={styles.thread}>
      {replies.length > 0 && (
        <ol className={styles.replies} aria-label="Replies">
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
              </div>
              {draft !== null && draft.replyId === reply.id ? editor(true) : <div className={styles.text}>{reply.text}</div>}
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
