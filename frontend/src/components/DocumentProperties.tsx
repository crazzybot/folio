import React, { useId } from "react";
import { propertiesLabel } from "../frontMatter";
import type { FrontMatter } from "../frontMatter";
import type { FrontMatterView } from "../readerPrefs";
import { requestDone, statusNew, statusText, supersedingDocument } from "../status";
import { newReplies } from "../threads";
import type { DocumentMeta, DocumentNote } from "../types";
import DocumentNoteIcon from "./DocumentNoteIcon";
import FrontMatterPanel from "./FrontMatterPanel";
import NoteRequest from "./NoteRequest";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentProperties.module.css";

/** The document's whole front matter, and whether it's open (useFrontMatterPrefs: shared by the header and the pinned bar). */
export interface FrontMatterProps {
  frontMatter: FrontMatter;
  open: boolean;
  setOpen: (open: boolean) => void;
  view: FrontMatterView;
  setView: (id: FrontMatterView["id"]) => void;
}

interface DocumentPropertiesProps {
  doc: DocumentMeta;
  documents: readonly DocumentMeta[];
  onOpenDocument?: ((id: string, anchor: string | null) => void) | undefined;
  /** The user's note on the document as a whole (document-notes.md). */
  note?: DocumentNote | undefined;
  /** Open the note editor under `from` (clicking the status, or Edit). */
  onEditNote?: ((from: HTMLElement) => void) | undefined;
  /** Front matter to open from the end of the strip; undefined when the document has none. */
  frontMatter?: FrontMatterProps | undefined;
  className?: string | undefined;
}

const NO_META = { status: null, statusDetail: null, date: null, people: [], tags: [], statusLine: null };

/**
 * The document's metadata (front matter, or its status line) above its
 * text: status, date and decision makers, then tags; and below them the
 * user's note on the document, if any and not resolved; and at the strip's
 * end, a toggle opening the whole front matter under it. Outside the
 * article, so highlights' text positions don't count it.
 */
export default function DocumentProperties({
  doc,
  documents,
  onOpenDocument,
  note,
  onEditNote,
  frontMatter,
  className,
}: DocumentPropertiesProps): React.ReactElement | null {
  const panelId = useId();
  // A resolved note is done with: it stays in the Marks view, and the status still opens it
  const shownNote = note?.state === "resolved" ? undefined : note;
  if (doc.meta === undefined && shownNote === undefined && frontMatter === undefined) return null;
  const meta = doc.meta ?? NO_META;
  const { status, date, people, tags } = meta;
  const done = shownNote !== undefined && requestDone(status, shownNote.requestedStatus);
  // Reached since the note was last opened: New beside the status, until it is
  const fresh = statusNew(status, shownNote);
  const newBadge = fresh && (
    <span className={styles.new} title="The status your note asked for: open the note to clear">
      New
    </span>
  );
  // A request that's done is said by the status itself (and New): the row keeps the comment and the thread
  const showRequest = shownNote?.requestedStatus != null && !done;
  const repliesNew = shownNote === undefined ? 0 : newReplies(shownNote).length;
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
              {newBadge}
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
              {newBadge}
            </>
          ) : (
            <button
              type="button"
              className={styles.statusButton}
              onClick={(e) => onEditNote(e.currentTarget)}
              aria-haspopup="dialog"
              title={fresh ? "The status your note asked for: open the note" : "Suggest a status change"}
            >
              <StatusIcon status={status} className={styles.statusIcon} />
              {statusText(meta)}
              {newBadge}
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
      {frontMatter !== undefined && (
        <button
          type="button"
          className={styles.propertiesToggle}
          onClick={() => frontMatter.setOpen(!frontMatter.open)}
          aria-expanded={frontMatter.open}
          aria-controls={frontMatter.open ? panelId : undefined}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={frontMatter.open ? "M2.5 4.5 6 8l3.5-3.5" : "M4.5 2.5 8 6l-3.5 3.5"} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {frontMatter.open ? "Properties" : propertiesLabel(frontMatter.frontMatter, doc.meta !== undefined)}
        </button>
      )}
      {frontMatter?.open === true && (
        <FrontMatterPanel id={panelId} frontMatter={frontMatter.frontMatter} view={frontMatter.view} onView={frontMatter.setView} />
      )}
      {shownNote !== undefined && (
        <div className={styles.note}>
          <span
            className={`${styles.noteIcon} ${repliesNew > 0 ? styles.noteIconNew : ""}`}
            title={repliesNew > 0 ? `Your note on this document: ${repliesNew === 1 ? "a new reply" : `${repliesNew} new replies`}` : "Your note on this document"}
          >
            <DocumentNoteIcon size={14} />
          </span>
          {showRequest && shownNote.requestedStatus !== null && (
            <NoteRequest
              requested={shownNote.requestedStatus}
              done={false}
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
