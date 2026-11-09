import React from "react";
import { documentsInFolder } from "../documentTree";
import { statusText } from "../status";
import type { DocumentMeta, Highlight } from "../types";
import StatusIcon from "./StatusIcon";
import styles from "./HoverCard.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A document: full title, location, metadata and marks. */
export function DocumentCard({
  doc,
  bookmarked,
  highlightCount,
}: {
  doc: DocumentMeta;
  bookmarked: boolean;
  highlightCount: number;
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
    </>
  );
}

/** A folder: its path, how many documents it holds and how many have highlights. */
export function FolderCard({
  folder,
  label,
  documents,
  highlightCounts,
}: {
  folder: string;
  label: string;
  documents: DocumentMeta[];
  highlightCounts: ReadonlyMap<string, number>;
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
}: {
  doc: DocumentMeta;
  highlight: Highlight;
  unplaced: boolean;
}): React.ReactElement {
  return (
    <>
      <blockquote className={`${styles.quote} ${styles[highlight.color] ?? ""}`}>{highlight.quote.exact}</blockquote>
      {highlight.note !== null && <div className={styles.note}>{highlight.note}</div>}
      <div className={styles.path}>{doc.location}</div>
      {unplaced && <div className={styles.detail}>Not found in the current text</div>}
    </>
  );
}
