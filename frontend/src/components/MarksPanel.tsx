import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { buildMarkRows } from "../marksView";
import type { MarkRow } from "../marksView";
import type { BookmarkHeading, DocumentMeta, Highlight, MissingMarks } from "../types";
import type { DocMarks } from "../useMarks";
import { BookmarkIcon } from "./MarksLayer";
import { ReviewNotesIcon } from "./ReviewNotesPanel";
import listStyles from "./DocumentList.module.css";
import styles from "./MarksPanel.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/** What opening a mark should scroll to: a highlight, a heading, or (null) the document's top. */
export type MarkTarget = { highlight: string } | { heading: BookmarkHeading } | null;

/** A document's highlights to copy as review notes. */
export interface ReviewSelection {
  doc: DocumentMeta;
  highlights: readonly Highlight[];
}

const NOTHING_FOLDED: ReadonlySet<string> = new Set();

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
  /** Marks of files in the workspace that no longer exist. */
  missing: readonly MissingMarks[];
  /** Every document in the workspace, to move a missing document's marks to. */
  allDocuments: readonly DocumentMeta[];
  onRelink: (recordId: string, docId: string) => void;
  onForget: (recordId: string) => void;
  /** Copy review notes on these highlights (shows the preview). */
  onCopyNotes: (selection: ReviewSelection[]) => void;
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
  missing,
  allDocuments,
  onRelink,
  onForget,
  onCopyNotes,
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
  // What the view shows, folded documents included: the highlights Copy review notes copies, by document
  const copyable = useMemo(() => {
    const byDocShown = new Map<string, ReviewSelection>();
    for (const row of buildMarkRows({ documents, byDoc, query, notesOnly, collapsed: NOTHING_FOLDED, located })) {
      if (row.kind !== "highlight") continue;
      const entry = byDocShown.get(row.doc.id);
      byDocShown.set(row.doc.id, { doc: row.doc, highlights: [...(entry?.highlights ?? []), row.highlight] });
    }
    return byDocShown;
  }, [documents, byDoc, query, notesOnly, located]);
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

  const hasAny = documents.some((doc) => byDoc.has(doc.id)) || missing.length > 0;
  // Missing documents' marks, narrowed by the filter like the rest
  const q = query.trim().toLowerCase();
  const shownMissing = missing.filter(
    (m) =>
      (!notesOnly || m.highlights.some((h) => h.note !== null)) &&
      (q === "" ||
        m.location.toLowerCase().includes(q) ||
        m.highlights.some((h) => `${h.quote.exact}\n${h.note ?? ""}`.toLowerCase().includes(q)) ||
        m.bookmarks.some((b) => b.heading?.text.toLowerCase().includes(q))),
  );

  return (
    <div className={listStyles.container}>
      <header className={listStyles.header}>{tabs}</header>

      {/* ── Filter, and Copy review notes on what it shows ── */}
      <div className={`${listStyles.searchWrapper} ${styles.filterRow}`}>
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
        <button
          type="button"
          className={styles.copyAll}
          onClick={() => onCopyNotes([...copyable.values()])}
          disabled={copyable.size === 0}
          aria-label="Copy review notes on the highlights shown"
          title="Copy review notes on the highlights shown"
        >
          <ReviewNotesIcon size={14} />
        </button>
      </div>

      {/* ── Marks ── */}
      <div className={listStyles.listBody} role="region" aria-label="Marks">
        {rows.length === 0 && shownMissing.length === 0 ? (
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
                onCopyNotes={() => {
                  const selection = copyable.get(row.doc.id);
                  if (selection !== undefined) onCopyNotes([selection]);
                }}
                copyable={row.kind === "document" && copyable.has(row.doc.id)}
              />
            ))}
          </ul>
        )}
        {shownMissing.length > 0 && (
          <MissingSection missing={shownMissing} documents={allDocuments} onRelink={onRelink} onForget={onForget} />
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
  /** A document row: copy review notes on its highlights shown. */
  onCopyNotes: () => void;
  /** A document row with highlights shown. */
  copyable: boolean;
}

function MarkRowItem({
  row,
  selected,
  tabStop,
  onFocus,
  onActivate,
  onToggle,
  onRemove,
  onCopyNotes,
  copyable,
}: MarkRowItemProps): React.ReactElement {
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
        {copyable && (
          <button
            type="button"
            className={styles.copyNotes}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onCopyNotes();
            }}
            aria-label={`Copy review notes on ${row.doc.title}`}
            title="Copy review notes"
          >
            <ReviewNotesIcon size={12} />
          </button>
        )}
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

// ─── Missing documents ───────────────────────────────────────────────────────

interface MissingSectionProps {
  missing: readonly MissingMarks[];
  documents: readonly DocumentMeta[];
  onRelink: (recordId: string, docId: string) => void;
  onForget: (recordId: string) => void;
}

/**
 * Marks of files that no longer exist (deleted, or moved and edited): moved
 * to the suggested document or one picked, or deleted. Nothing is deleted
 * without asking.
 */
function MissingSection({ missing, documents, onRelink, onForget }: MissingSectionProps): React.ReactElement {
  return (
    <section className={styles.missingSection} aria-labelledby="folio-missing-heading">
      <h2 id="folio-missing-heading" className={styles.missingHeading}>
        Missing documents ({missing.length})
      </h2>
      <p className={styles.missingHint}>Their files were moved or deleted. Move the marks to a document, or delete them.</p>
      <ul className={styles.list}>
        {missing.map((m) => (
          <MissingItem key={m.recordId} marks={m} documents={documents} onRelink={onRelink} onForget={onForget} />
        ))}
      </ul>
    </section>
  );
}

interface MissingItemProps {
  marks: MissingMarks;
  documents: readonly DocumentMeta[];
  onRelink: (recordId: string, docId: string) => void;
  onForget: (recordId: string) => void;
}

function MissingItem({ marks, documents, onRelink, onForget }: MissingItemProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "pick" | "delete">("idle");
  const [choice, setChoice] = useState("");
  const pickerId = useId();
  const slash = marks.location.lastIndexOf("/");
  const filename = marks.location.slice(slash + 1);
  const folder = slash === -1 ? null : marks.location.slice(0, slash);
  const count = marks.bookmarks.length + marks.highlights.length;
  const label = `${count} ${count === 1 ? "mark" : "marks"}`;
  const chosen = documents.find((doc) => doc.location === choice.trim());

  return (
    <li className={styles.missingItem}>
      <div className={styles.missingRow}>
        <button
          type="button"
          className={styles.chevronBtn}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the marks of ${marks.location}`}
        >
          <svg
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
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
        <span className={styles.missingLabel} title={marks.location}>
          <span className={styles.missingName}>{filename}</span>
          {folder !== null && <span className={styles.missingFolder}>{folder}</span>}
        </span>
        <span className={styles.count}>{count}</span>
      </div>

      {open && (
        <ul className={styles.missingMarks} aria-label={`Marks of ${marks.location}`}>
          {marks.bookmarks.map((b) => (
            <li key={b.id} className={styles.missingMark}>
              <span className={styles.bookmarkIcon}>
                <BookmarkIcon filled />
              </span>
              {b.heading?.text ?? "The document"}
            </li>
          ))}
          {marks.highlights.map((h) => (
            <li key={h.id} className={styles.missingMark}>
              <span className={`${styles.colorBar} ${styles[h.color]}`} aria-hidden="true" />
              <span className={styles.highlightBody}>
                <span className={styles.quote}>{h.quote.exact}</span>
                {h.note !== null && <span className={styles.noteText}>{h.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mode === "idle" && (
        <div className={styles.missingActions}>
          {marks.suggestion !== null && (
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => marks.suggestion && onRelink(marks.recordId, marks.suggestion.docId)}
              title={`Move the ${label} to ${marks.suggestion.location}`}
            >
              Move to {marks.suggestion.location}
            </button>
          )}
          <button type="button" className={styles.textAction} onClick={() => setMode("pick")}>
            Move to…
          </button>
          <button type="button" className={styles.textAction} onClick={() => setMode("delete")}>
            Delete
          </button>
        </div>
      )}

      {mode === "pick" && (
        <form
          className={styles.missingActions}
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen !== undefined) onRelink(marks.recordId, chosen.id);
          }}
        >
          <label htmlFor={pickerId} className={listStyles.srOnly}>
            Document to move the marks to
          </label>
          <input
            id={pickerId}
            className={styles.picker}
            list={`${pickerId}-documents`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMode("idle");
            }}
            placeholder="Document…"
            autoFocus
          />
          <datalist id={`${pickerId}-documents`}>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.location}>
                {doc.title}
              </option>
            ))}
          </datalist>
          <button type="submit" className={styles.primaryAction} disabled={chosen === undefined}>
            Move
          </button>
          <button type="button" className={styles.textAction} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      )}

      {mode === "delete" && (
        <div className={styles.missingActions} role="group" aria-label="Confirm delete">
          <span className={styles.confirmText}>Delete {label}?</span>
          <button type="button" className={styles.dangerAction} onClick={() => onForget(marks.recordId)} autoFocus>
            Delete
          </button>
          <button type="button" className={styles.textAction} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
