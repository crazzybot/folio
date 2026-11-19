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
  /** The user's note on the document as a whole (document-notes.md). */
  note?: DocumentNote | undefined;
  /** Open the note editor under `from` (clicking the status, or Edit). */
  onEditNote?: ((from: HTMLElement) => void) | undefined;
  className?: string | undefined;
}

const NO_META = { status: null, statusDetail: null, date: null, people: [], tags: [], statusLine: null };

/**
 * The document's metadata (front matter, or its status line) above its
 * text: status, date and decision makers, then tags; and below them the
 * user's note on the document, if any and not resolved. Outside the article, so highlights'
 * text positions don't count it.
 */
export default function DocumentProperties({
  doc,
  documents,
  onOpenDocument,
  note,
  onEditNote,
  className,
}: DocumentPropertiesProps): React.ReactElement | null {
  // A resolved note is done with: it stays in the Marks view, and the status still opens it
  const shownNote = note?.state === "resolved" ? undefined : note;
  if (doc.meta === undefined && shownNote === undefined) return null;
  const meta = doc.meta ?? NO_META;
  const { status, date, people, tags } = meta;
  const done = shownNote !== undefined && requestDone(status, shownNote.requestedStatus);
  const successor = onOpenDocument === undefined ? null : supersedingDocument(doc, documents);
  const described = [date, people.length > 0 ? people.join(", ") : null].filter((part): part is string => part !== null);

  return (
    <div className={`${styles.properties} ${className ?? ""}`} aria-label="Document properties" role="group">
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
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              #{tag}
            </span>
          ))}
        </span>
      )}
      {shownNote !== undefined && (
        <div className={styles.note}>
          <span className={styles.noteIcon} title="Your note on this document">
            <DocumentNoteIcon size={14} />
          </span>
          {shownNote.requestedStatus !== null && (
            <NoteRequest
              requested={shownNote.requestedStatus}
              done={done}
              className={styles.request}
              iconClassName={styles.statusIcon}
            />
          )}
          {shownNote.text !== null && <span className={styles.noteText}>{shownNote.text.split("\n")[0]}</span>}
          {onEditNote !== undefined && (
            <button type="button" className={`${styles.link} ${styles.noteAction}`} onClick={(e) => onEditNote(e.currentTarget)}>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
