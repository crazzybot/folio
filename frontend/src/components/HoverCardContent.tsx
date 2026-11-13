import React from "react";
import { documentsInFolder } from "../documentTree";
import { branchSentence, folderName } from "../git";
import { requestDone, statusText } from "../status";
import { isPrivate, lastSent, loopSentence, needsYou, sendableNote, stateOf } from "../sending";
import type { NoteIconKind } from "../noteIcons";
import type { DocumentMeta, DocumentNote, GitRepository, Highlight, Round } from "../types";
import NoteRequest from "./NoteRequest";
import NoteStateIcon from "./NoteStateIcon";
import StatusIcon from "./StatusIcon";
import styles from "./HoverCard.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A document: full title, location, metadata and marks. */
export function DocumentCard({
  doc,
  bookmarked,
  highlightCount,
  note,
}: {
  doc: DocumentMeta;
  bookmarked: boolean;
  highlightCount: number;
  /** The user's note on the document: its request and the comment's first line. */
  note?: DocumentNote | undefined;
}): React.ReactElement {
  const marks = [bookmarked && "Bookmarked", highlightCount > 0 && plural(highlightCount, "highlight", "highlights")].filter(Boolean);
  const { status = null, statusDetail = null, date = null, people = [], tags = [] } = doc.meta ?? {};
  return (
    <>
      <div className={styles.title}>{doc.title}</div>
      <div className={styles.path}>{doc.location}</div>
      {(status !== null || date !== null) && (
        <div className={styles.status}>
          {status !== null && <StatusIcon status={status} className={styles.statusIcon} />}
          {[status === null ? null : statusText({ status, statusDetail }), date].filter(Boolean).join(" · ")}
        </div>
      )}
      {people.length > 0 && <div className={styles.detail}>{people.join(", ")}</div>}
      {tags.length > 0 && <div className={styles.detail}>{tags.map((tag) => `#${tag}`).join("  ")}</div>}
      {marks.length > 0 && <div className={styles.detail}>{marks.join(" · ")}</div>}
      {note !== undefined && <NoteSummary note={note} status={status} />}
    </>
  );
}

/** "Your note: → Accepted · first line of the comment". */
function NoteSummary({ note, status }: { note: DocumentNote; status: string | null }): React.ReactElement {
  return (
    <div className={styles.noteSummary}>
      Your note:{" "}
      {note.requestedStatus !== null && (
        <NoteRequest
          requested={note.requestedStatus}
          done={requestDone(status, note.requestedStatus)}
          className={styles.request}
          iconClassName={styles.requestIcon}
        />
      )}
      {note.requestedStatus !== null && note.text !== null && " · "}
      {note.text?.split("\n")[0]}
    </div>
  );
}

/** Where a note is in the review loop: its icon and a sentence. */
function LoopLine({ kind, sent }: { kind: NoteIconKind; sent: string | null }): React.ReactElement {
  return (
    <div className={`${styles.loop} ${needsYou(kind) ? styles.loopNeedsYou : ""}`}>
      <NoteStateIcon kind={kind} size={12} />
      {loopSentence(kind, sent)}
    </div>
  );
}

/** The note on a document (Marks view): its request and the comment in full, and where it is in the review loop. */
export function DocumentNoteCard({
  doc,
  note,
  rounds,
}: {
  doc: DocumentMeta;
  note: DocumentNote;
  rounds?: readonly Round[] | undefined;
}): React.ReactElement {
  const kind: NoteIconKind = sendableNote(note, doc.meta?.status) === null ? "private" : stateOf(note);
  return (
    <>
      <div className={styles.title}>Note on {doc.title}</div>
      {note.requestedStatus !== null && (
        <div className={styles.status}>
          <NoteRequest
            requested={note.requestedStatus}
            done={requestDone(doc.meta?.status, note.requestedStatus)}
            className={styles.request}
            iconClassName={styles.requestIcon}
          />
        </div>
      )}
      {note.text !== null && <div className={styles.note}>{note.text}</div>}
      <LoopLine kind={kind} sent={kind === "sent" ? lastSent(rounds, null) : null} />
      <div className={styles.path}>{doc.location}</div>
    </>
  );
}

/**
 * A folder: its path, how many documents it holds and how many have
 * highlights, and the branch of the git repository it's in (desktop).
 */
export function FolderCard({
  folder,
  label,
  documents,
  highlightCounts,
  repository = null,
}: {
  folder: string;
  label: string;
  documents: DocumentMeta[];
  highlightCounts: ReadonlyMap<string, number>;
  repository?: GitRepository | null;
}): React.ReactElement {
  const inside = documentsInFolder(documents, folder);
  const highlighted = inside.filter((doc) => (highlightCounts.get(doc.id) ?? 0) > 0).length;
  return (
    <>
      <div className={styles.title}>{label}</div>
      <div className={styles.path}>{folder}</div>
      <div className={styles.detail}>
        {plural(inside.length, "document", "documents")}
        {highlighted > 0 && ` · ${highlighted} with highlights`}
      </div>
      {repository !== null && (
        <div className={styles.detail}>
          {branchSentence(repository)}
          {repository.mainCheckout !== null && ` · worktree of ${folderName(repository.mainCheckout)}`}
        </div>
      )}
    </>
  );
}

/** A bookmarked heading: the heading in full, and where it is. */
export function BookmarkCard({ doc, heading, missing }: { doc: DocumentMeta; heading: string; missing: boolean }): React.ReactElement {
  return (
    <>
      <div className={styles.title}>{heading}</div>
      <div className={styles.detail}>{doc.title}</div>
      <div className={styles.path}>{doc.location}</div>
      {missing && <div className={styles.detail}>Heading not found in the current text</div>}
    </>
  );
}

/** A highlight: the passage and its note in full (the row cuts them short). */
export function HighlightCard({
  doc,
  highlight,
  unplaced,
  rounds,
}: {
  doc: DocumentMeta;
  highlight: Highlight;
  unplaced: boolean;
  rounds?: readonly Round[] | undefined;
}): React.ReactElement {
  const kind: NoteIconKind = isPrivate(highlight) ? "private" : stateOf(highlight);
  return (
    <>
      <blockquote className={`${styles.quote} ${styles[highlight.color] ?? ""}`}>{highlight.quote.exact}</blockquote>
      {highlight.note !== null && <div className={styles.note}>{highlight.note}</div>}
      <LoopLine kind={kind} sent={kind === "sent" ? lastSent(rounds, highlight.id) : null} />
      <div className={styles.path}>{doc.location}</div>
      {unplaced && <div className={styles.detail}>Not found in the current text</div>}
    </>
  );
}
