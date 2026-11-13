/**
 * NoteThread.tsx — The replies under a note, each with its author and time,
 * and a box for the user's own (docs/design/agent-integration.md). Shown in
 * a highlight's popover and the note on the document.
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
  /** Whether the reply box is open: the popover keeps Escape for it while it is. */
  onWritingChange?: (writing: boolean) => void;
}

export default function NoteThread({ thread, onReply, onWritingChange }: NoteThreadProps): React.ReactElement | null {
  const [draft, setDraft] = useState<string | null>(null);
  const replies = thread.replies ?? [];
  // Captured when shown, so the replies stay marked new while the thread is open
  const [fresh] = useState(() => new Set(newReplies(thread).map((r) => r.id)));

  const write = (next: string | null) => {
    setDraft(next);
    onWritingChange?.(next !== null);
  };
  const send = () => {
    if (draft !== null && draft.trim() !== "") onReply(draft.trim());
    write(null);
  };

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
              </div>
              <div className={styles.text}>{reply.text}</div>
            </li>
          ))}
        </ol>
      )}

      {draft === null ? (
        <button type="button" className={styles.replyBtn} onClick={() => write("")}>
          Reply
        </button>
      ) : (
        <div className={styles.editor}>
          <textarea
            className={styles.field}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
            aria-label="Reply"
            placeholder="Reply… it goes with the next round"
            rows={3}
            maxLength={10_000}
            autoFocus
          />
          <div className={styles.actions}>
            <span className={styles.hint}>{SEND_SHORTCUT} to send · Esc to cancel</span>
            <button type="button" className={styles.sendBtn} onClick={send} disabled={draft.trim() === ""}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
