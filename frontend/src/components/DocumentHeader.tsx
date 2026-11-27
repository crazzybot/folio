import React, { useEffect, useRef, useState } from "react";
import { statusNew, statusText } from "../status";
import { newReplies } from "../threads";
import type { FrontMatter } from "../frontMatter";
import { useFrontMatterPrefs } from "../readerPrefs";
import type { DocumentMeta, DocumentNote } from "../types";
import ChangesBanner, { changedParts } from "./ChangesBanner";
import type { ChangesBannerProps } from "./ChangesBanner";
import DocumentNoteIcon from "./DocumentNoteIcon";
import DocumentProperties from "./DocumentProperties";
import type { FrontMatterProps } from "./DocumentProperties";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentHeader.module.css";

interface DocumentHeaderProps {
  /** The scroll container the header is at the top of. */
  containerRef: React.RefObject<HTMLElement | null>;
  doc: DocumentMeta | undefined;
  documents: readonly DocumentMeta[];
  onOpenDocument?: ((id: string, anchor: string | null) => void) | undefined;
  note?: DocumentNote | undefined;
  onEditNote?: ((from: HTMLElement) => void) | undefined;
  /** The document's front matter, opened from the properties strip; null when it has none. */
  frontMatter: FrontMatter | null;
  /** What changed since the document was read, while that's shown. */
  changes?: ChangesBannerProps | undefined;
  /** Notes not found in the current text that still need the user (unplacedFirst in sending.ts). */
  notFound: number;
  /** Where the marks layer lists the highlights not found in the text: in the header, and in the pinned bar's details while open. */
  onUnplacedSlot: (el: HTMLDivElement | null) => void;
  onPinnedSlot: (el: HTMLDivElement | null) => void;
}

/** A resolved note is done with: the header doesn't show it (DocumentProperties). */
function shownNote(note: DocumentNote | undefined): DocumentNote | undefined {
  return note?.state === "resolved" ? undefined : note;
}

/**
 * The header has a summary to pin to the top of the view once it's
 * scrolled past: a status, an open note on the document, or news.
 */
export function hasPinnedSummary(
  doc: DocumentMeta | undefined,
  note: DocumentNote | undefined,
  changes: ChangesBannerProps | undefined,
  notFound: number,
): boolean {
  return (doc?.meta?.status ?? null) !== null || shownNote(note) !== undefined || changes !== undefined || notFound > 0;
}

/**
 * Above the document's text: its properties (status, date, people, tags,
 * the user's note), then what happened to it, in one card: the sections
 * that changed since it was read, and the highlights no longer found in
 * it. Once the header is scrolled out of view, a one-line summary of it
 * stays pinned to the top of the view: the status is always in sight, and
 * a highlight that went missing doesn't go unnoticed further down. The
 * whole header opens under it.
 */
export default function DocumentHeader({
  containerRef,
  doc,
  documents,
  onOpenDocument,
  note,
  onEditNote,
  frontMatter,
  changes,
  notFound,
  onUnplacedSlot,
  onPinnedSlot,
}: DocumentHeaderProps): React.ReactElement {
  // One choice for the header and the details under the pinned bar
  const frontMatterPrefs = useFrontMatterPrefs();
  const frontMatterProps: FrontMatterProps | undefined = frontMatter === null ? undefined : { frontMatter, ...frontMatterPrefs };
  const headerRef = useRef<HTMLDivElement>(null);
  const summary = hasPinnedSummary(doc, note, changes, notFound);
  // The header is above the top of the view (not merely below its bottom)
  const [scrolledPast, setScrolledPast] = useState(false);
  // The details under the pinned bar, open for this document
  const docKey = doc?.id ?? "";
  const [openFor, setOpenFor] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const header = headerRef.current;
    if (container === null || header === null || !summary) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        const top = entry.rootBounds?.top ?? container.getBoundingClientRect().top;
        const past = !entry.isIntersecting && entry.boundingClientRect.bottom <= top;
        setScrolledPast(past);
        // Back at the header: the details close
        if (!past) setOpenFor(null);
      },
      { root: container },
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, [containerRef, summary]);

  const pinned = summary && scrolledPast;
  const open = pinned && openFor === docKey;
  const setOpen = (value: boolean) => setOpenFor(value ? docKey : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const status = doc?.meta?.status ?? null;
  const openNote = shownNote(note);
  const repliesNew = openNote === undefined ? 0 : newReplies(openNote).length;
  const { named, others } = changedParts(changes?.changes ?? null);
  const sections = [...named.map(({ heading }) => heading.text), ...others];

  return (
    <>
      {pinned && (
        <div className={styles.pin}>
          <div className={styles.bar} role="region" aria-label="Document summary">
            {/* At the bar's right edge, outside the text's column. Open, the
                whole header takes the summary's place: it would only repeat it */}
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? "Hide details" : "Show details"}
              title={open ? "Hide details" : "Show details"}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d={open ? "M2.5 7.5 6 4l3.5 3.5" : "M2.5 4.5 6 8l3.5-3.5"} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {!open && (
              <div className={styles.row}>
                {status !== null && doc?.meta !== undefined && (
                  <span className={styles.status}>
                    <StatusIcon status={status} className={styles.statusIcon} />
                    {statusText(doc.meta)}
                    {statusNew(status, openNote) && <span className={styles.new}>New</span>}
                  </span>
                )}
                {openNote !== undefined && (
                  <span
                    className={`${styles.noteIcon} ${repliesNew > 0 ? styles.noteIconNew : ""}`}
                    title={repliesNew > 0 ? (repliesNew === 1 ? "A new reply to your note" : `${repliesNew} new replies to your note`) : (openNote.text ?? "Your note on this document")}
                  >
                    <DocumentNoteIcon size={14} />
                  </span>
                )}
                {changes !== undefined && (
                  <span className={styles.changed}>
                    <span className={styles.dot} aria-hidden="true" />
                    <span className={styles.changedText}>
                      {sections.length > 0 ? `Changed: ${sections.join(", ")}` : "Changed"}
                    </span>
                  </span>
                )}
                {notFound > 0 && (
                  <button type="button" className={styles.notFound} onClick={() => setOpen(true)}>
                    {notFound === 1 ? "1 note not found" : `${notFound} notes not found`}
                  </button>
                )}
              </div>
            )}
            {open && (
              <div className={styles.details}>
                {doc !== undefined && (
                  <DocumentProperties
                    className={styles.detailsProperties}
                    doc={doc}
                    documents={documents}
                    onOpenDocument={onOpenDocument}
                    note={note}
                    onEditNote={onEditNote}
                    frontMatter={frontMatterProps}
                  />
                )}
                <div className={styles.news}>
                  {changes !== undefined && (
                    <ChangesBanner
                      {...changes}
                      onOpenSection={(heading) => {
                        setOpen(false);
                        changes.onOpenSection(heading);
                      }}
                    />
                  )}
                  <div ref={onPinnedSlot} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={headerRef} className={styles.header}>
        {doc !== undefined && (
          <DocumentProperties
            doc={doc}
            documents={documents}
            onOpenDocument={onOpenDocument}
            note={note}
            onEditNote={onEditNote}
            frontMatter={frontMatterProps}
          />
        )}
        <div className={styles.newsColumn}>
          <div className={styles.news}>
            {changes !== undefined && <ChangesBanner {...changes} />}
            <div ref={onUnplacedSlot} />
          </div>
        </div>
      </div>
    </>
  );
}
