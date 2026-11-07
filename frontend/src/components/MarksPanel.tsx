import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { buildMarkRows } from "../marksView";
import type { MarkRow } from "../marksView";
import type { BookmarkHeading, DocumentMeta } from "../types";
import type { DocMarks } from "../useMarks";
import { BookmarkIcon } from "./MarksLayer";
import listStyles from "./DocumentList.module.css";
import styles from "./MarksPanel.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/** What opening a mark should scroll to: a highlight, a heading, or (null) the document's top. */
export type MarkTarget = { highlight: string } | { heading: BookmarkHeading } | null;

interface MarksPanelProps {
  /** The sidebar's Documents | Marks switch, shown in the header. */
  tabs: React.ReactNode;
  /** The listed documents (the focused folder's, if any), in list order. */
  documents: readonly DocumentMeta[];
  /** The open document, whose marks stand out. */
  current: DocumentMeta | null;
  byDoc: ReadonlyMap<string, DocMarks>;
  /** The open document's highlights found in its text. */
  located: { docId: string; ids: ReadonlySet<string> } | null;
  onOpen: (docId: string, target: MarkTarget) => void;
  onRemoveHighlight: (docId: string, highlightId: string) => void;
  onRemoveBookmark: (docId: string, bookmarkId: string) => void;
}

/**
 * The sidebar's Marks view: bookmarks, then highlights and notes, of every
 * listed document (the workspace, or the focused folder). Opening one goes
 * to it in the viewer. The open document's marks also show in its outline.
 */
export default function MarksPanel({
  tabs,
  documents,
  current,
  byDoc,
  located,
  onOpen,
  onRemoveHighlight,
  onRemoveBookmark,
}: MarksPanelProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [notesOnly, setNotesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const filterId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const rows = useMemo(
    () => buildMarkRows({ documents, byDoc, query, notesOnly, collapsed, located }),
    [documents, byDoc, query, notesOnly, collapsed, located],
  );
  const tabStop = (rows.some((r) => r.key === focusKey) ? focusKey : undefined) ?? rows[0]?.key;

  const toggleCollapsed = useCallback((docId: string, open?: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  // A document row opens the document (and shows its marks); the others go to their mark
  const activate = (row: MarkRow) => {
    if (row.kind === "document") {
      onOpen(row.doc.id, null);
      if (row.count > 0) toggleCollapsed(row.doc.id, true);
    } else if (row.kind === "bookmark") onOpen(row.doc.id, row.missing ? null : { heading: row.bookmark.heading });
    else onOpen(row.doc.id, row.unplaced ? null : { highlight: row.highlight.id });
  };

  const remove = (row: MarkRow) => {
    if (row.kind === "document") {
      if (row.bookmark !== undefined) onRemoveBookmark(row.doc.id, row.bookmark.id);
    } else if (row.kind === "bookmark") onRemoveBookmark(row.doc.id, row.bookmark.id);
    else onRemoveHighlight(row.doc.id, row.highlight.id);
  };

  // ── Keyboard: ↑ ↓ Home End move, → ← open / fold a document, Enter opens ──
  const rowElements = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
  const focusRow = (key: string | undefined) => {
    const el = rowElements().find((e) => e.dataset["row"] === key);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  };

  function onListKeyDown(e: React.KeyboardEvent) {
    const elements = rowElements();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const row = rows.find((r) => r.key === elements[index]?.dataset["row"]);
    if (index < 0 || row === undefined) return;
    const at = (i: number) => elements[Math.max(0, Math.min(elements.length - 1, i))]?.dataset["row"];
    switch (e.key) {
      case "ArrowDown":
        focusRow(at(index + 1));
        break;
      case "ArrowUp":
        if (index === 0) inputRef.current?.focus();
        else focusRow(at(index - 1));
        break;
      case "Home":
        focusRow(at(0));
        break;
      case "End":
        focusRow(at(elements.length - 1));
        break;
      case "ArrowRight":
        if (row.kind !== "document" || row.count === 0) return;
        if (row.expanded) focusRow(at(index + 1));
        else toggleCollapsed(row.doc.id, true);
        break;
      case "ArrowLeft":
        // Fold the document, or from a mark go to its document
        if (row.kind === "document" && row.expanded) toggleCollapsed(row.doc.id, false);
        else if (row.kind !== "document") focusRow(`d:${row.doc.id}`);
        else return;
        break;
      case "Enter":
      case " ":
        activate(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const hasAny = documents.some((doc) => byDoc.has(doc.id));

  return (
    <div className={listStyles.container}>
      <header className={listStyles.header}>{tabs}</header>

      {/* ── Filter ── */}
      <div className={listStyles.searchWrapper}>
        <label htmlFor={filterId} className={listStyles.srOnly}>
          Filter marks
        </label>
        <div className={listStyles.searchInputWrapper}>
          <svg className={listStyles.searchIcon} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            id={filterId}
            ref={inputRef}
            type="search"
            className={listStyles.searchInput}
            placeholder="Filter marks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && tabStop !== undefined) {
                e.preventDefault();
                focusRow(tabStop);
              }
            }}
          />
          <button
            type="button"
            className={`${listStyles.fullTextBtn} ${notesOnly ? listStyles.fullTextBtnOn : ""}`}
            onClick={() => setNotesOnly(!notesOnly)}
            aria-pressed={notesOnly}
            aria-label="Notes only"
            title="Notes only"
          >
            <NoteIcon />
          </button>
          {query && (
            <button type="button" className={listStyles.clearBtn} onClick={() => setQuery("")} aria-label="Clear filter">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Marks ── */}
      <div className={listStyles.listBody} role="region" aria-label="Marks">
        {rows.length === 0 ? (
          <div className={listStyles.emptyArea}>
            {!hasAny ? (
              <>
                <p>No bookmarks or highlights yet.</p>
                <p className={styles.hint}>
                  Select text to highlight it, or press {IS_MAC ? "⌘D" : "Ctrl+D"} to bookmark the document.
                </p>
              </>
            ) : notesOnly && query === "" ? (
              <p>No notes yet. Click a highlight to add one.</p>
            ) : (
              <p>No marks match "<strong>{query}</strong>".</p>
            )}
          </div>
        ) : (
          <ul ref={listRef} className={styles.list} role="tree" aria-label="Marks" onKeyDown={onListKeyDown}>
            {rows.map((row) => (
              <MarkRowItem
                key={row.key}
                row={row}
                // The open document and its marks stand out
                selected={row.doc.id === current?.id}
                tabStop={row.key === tabStop}
                onFocus={() => setFocusKey(row.key)}
                onActivate={() => activate(row)}
                onToggle={() => toggleCollapsed(row.doc.id)}
                onRemove={() => remove(row)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

interface MarkRowItemProps {
  row: MarkRow;
  /** The open document, or one of its marks. */
  selected: boolean;
  tabStop: boolean;
  onFocus: () => void;
  onActivate: () => void;
  /** Fold or unfold a document's marks (its chevron). */
  onToggle: () => void;
  /** Remove the mark (a document row: its bookmark). */
  onRemove: () => void;
}

function MarkRowItem({ row, selected, tabStop, onFocus, onActivate, onToggle, onRemove }: MarkRowItemProps): React.ReactElement {
  const common = {
    "data-row": row.key,
    tabIndex: tabStop ? 0 : -1,
    onFocus,
    onClick: onActivate,
    role: "treeitem",
    "aria-level": row.kind === "document" ? 1 : 2,
    "aria-selected": false,
  } as const;

  const removeButton = (label: string) => (
    <button
      type="button"
      className={styles.remove}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={label}
      title={label}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );

  if (row.kind === "document") {
    const bookmarked = row.bookmark !== undefined;
    return (
      <li
        {...common}
        className={`${styles.docRow} ${selected ? styles.current : ""}`}
        {...(row.count > 0 ? { "aria-expanded": row.expanded } : {})}
        aria-label={`${row.doc.title}${bookmarked ? ", bookmarked" : ""}${row.count > 0 ? `, ${row.count} ${row.count === 1 ? "mark" : "marks"}` : ""}`}
        title={row.doc.location}
      >
        {row.count > 0 ? (
          <button
            type="button"
            className={styles.chevronBtn}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={row.expanded ? "Fold" : "Unfold"}
          >
            <svg
              className={`${styles.chevron} ${row.expanded ? styles.chevronOpen : ""}`}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" strokeWidth="1.2" />
            </svg>
          </button>
        ) : (
          <span className={styles.chevronSpace} aria-hidden="true" />
        )}
        <span className={styles.docTitle}>{row.doc.title}</span>
        {bookmarked && (
          <button
            type="button"
            className={styles.docBookmark}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Remove the document's bookmark"
            title="Remove bookmark"
          >
            <BookmarkIcon filled />
          </button>
        )}
        {row.count > 0 && <span className={styles.count}>{row.count}</span>}
      </li>
    );
  }

  if (row.kind === "bookmark") {
    const { heading } = row.bookmark;
    return (
      <li
        {...common}
        className={`${styles.markRow} ${styles.bookmarkRow} ${selected ? styles.current : ""}`}
        aria-label={`Bookmark: ${heading.text}${row.missing ? " (heading not found)" : ""}`}
        title={`${row.doc.title} › ${heading.text}`}
      >
        <span className={styles.bookmarkIcon}>
          <BookmarkIcon filled />
        </span>
        <span className={styles.bookmarkText}>
          <span className={row.missing ? styles.missing : undefined}>{heading.text}</span>
          {row.missing && <span className={styles.notFound}> — heading not found</span>}
        </span>
        {removeButton("Remove bookmark")}
      </li>
    );
  }

  const { highlight, unplaced } = row;
  return (
    <li
      {...common}
      className={`${styles.markRow} ${styles.highlightRow} ${selected ? styles.current : ""}`}
      aria-label={`Highlight: ${highlight.quote.exact}${highlight.note === null ? "" : `. Note: ${highlight.note}`}${unplaced ? ". Not found in the current text" : ""}`}
    >
      <span className={`${styles.colorBar} ${styles[highlight.color]}`} aria-hidden="true" />
      <span className={styles.highlightBody}>
        <span className={`${styles.quote} ${unplaced ? styles.missing : ""}`}>{highlight.quote.exact}</span>
        {highlight.note !== null && (
          <span className={styles.note}>
            <NoteIcon />
            <span className={styles.noteText}>{highlight.note}</span>
          </span>
        )}
        {unplaced && <span className={styles.notFound}>Not found in the current text</span>}
      </span>
      {removeButton("Remove highlight")}
    </li>
  );
}

function NoteIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  );
}
