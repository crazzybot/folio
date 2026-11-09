import React from "react";
import { requestDone, statusText, supersedingDocument } from "../status";
import type { DocumentMeta, DocumentNote } from "../types";
import DocumentNoteIcon from "./DocumentNoteIcon";
import NoteRequest from "./NoteRequest";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentProperties.module.css";

interface DocumentPropertiesProps {
  doc: DocumentMeta;
  documents: readonly DocumentMeta[];
  onOpenDocument?: ((id: string, anchor: string | null) => void) | undefined;
  /** Filter the document list by a tag (clicking it). */
  onFilterBy?: ((kind: "status" | "tag", value: string) => void) | undefined;
  /** The user's note on the document as a whole (document-notes.md). */
  note?: DocumentNote | undefined;
  /** Open the note editor under `from` (clicking the status, or Edit). */
  onEditNote?: ((from: HTMLElement) => void) | undefined;
  /** Remove the note's requested status, once the document has it. */
  onClearRequest?: (() => void) | undefined;
}

const NO_META = { status: null, statusDetail: null, date: null, people: [], tags: [], statusLine: null };

/**
 * The document's metadata (front matter, or its status line) above its
 * text: status, date and decision makers, then tags; and below them the
 * user's note on the document, if any. Outside the article, so highlights'
 * text positions don't count it.
 */
export default function DocumentProperties({
  doc,
  documents,
  onOpenDocument,
  onFilterBy,
  note,
  onEditNote,
  onClearRequest,
}: DocumentPropertiesProps): React.ReactElement | null {
  if (doc.meta === undefined && note === undefined) return null;
  const meta = doc.meta ?? NO_META;
  const { status, date, people, tags } = meta;
  const done = note !== undefined && requestDone(status, note.requestedStatus);
  const successor = onOpenDocument === undefined ? null : supersedingDocument(doc, documents);
  const described = [date, people.length > 0 ? people.join(", ") : null].filter((part): part is string => part !== null);

  return (
    <div className={styles.properties} aria-label="Document properties" role="group">
      {status !== null && (
        <span className={styles.status}>
          {onEditNote === undefined ? (
            <>
              <StatusIcon status={status} className={styles.statusIcon} />
              {successor !== null ? (
                <button type="button" className={styles.link} onClick={() => onOpenDocument?.(successor.id, null)} title={successor.location}>
                  {statusText(meta)}
                </button>
              ) : (
                statusText(meta)
              )}
            </>
          ) : successor !== null ? (
            // The text links to the successor; the glyph opens the note
            <>
              <button
                type="button"
                className={styles.statusButton}
                onClick={(e) => onEditNote(e.currentTarget)}
                aria-haspopup="dialog"
                aria-label={`Status: ${status}. Suggest a change`}
                title="Suggest a status change"
              >
                <StatusIcon status={status} className={styles.statusIcon} />
              </button>
              <button type="button" className={styles.link} onClick={() => onOpenDocument?.(successor.id, null)} title={successor.location}>
                {statusText(meta)}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.statusButton}
              onClick={(e) => onEditNote(e.currentTarget)}
              aria-haspopup="dialog"
              title="Suggest a status change"
            >
              <StatusIcon status={status} className={styles.statusIcon} />
              {statusText(meta)}
            </button>
          )}
        </span>
      )}
      {described.map((part) => (
        <span key={part} className={styles.detail}>
          {part}
        </span>
      ))}
      {tags.length > 0 && (
        <span className={styles.tags}>
          {tags.map((tag) =>
            onFilterBy === undefined ? (
              <span key={tag} className={styles.tag}>
                #{tag}
              </span>
            ) : (
              <button
                key={tag}
                type="button"
                className={`${styles.tag} ${styles.tagButton}`}
                onClick={() => onFilterBy("tag", tag)}
                title={`Show only documents tagged #${tag}`}
              >
                #{tag}
              </button>
            ),
          )}
        </span>
      )}
      {note !== undefined && (
        <div className={styles.note}>
          <span className={styles.noteIcon} title="Your note on this document">
            <DocumentNoteIcon size={14} />
          </span>
          {note.requestedStatus !== null && (
            <NoteRequest
              requested={note.requestedStatus}
              done={done}
              className={styles.request}
              iconClassName={styles.statusIcon}
            />
          )}
          {done && onClearRequest !== undefined && (
            <button type="button" className={styles.link} onClick={onClearRequest}>
              Clear request
            </button>
          )}
          {note.text !== null && <span className={styles.noteText}>{note.text.split("\n")[0]}</span>}
          {onEditNote !== undefined && (
            <button type="button" className={styles.link} onClick={(e) => onEditNote(e.currentTarget)}>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
