import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildMarkRows } from "../marksView";
import type { MarkKind, MarkRow } from "../marksView";
import { filterOf, noteFilterOf, shownStates, STATE_FILTERS } from "../sending";
import type { StateFilter } from "../sending";
import { newReplies } from "../threads";
import { noteIconOf } from "./MarksLayer";
import NoteStateIcon from "./NoteStateIcon";
import type { BookmarkHeading, DocumentMeta, Highlight, MissingMarks } from "../types";
import type { DocMarks } from "../useMarks";
import { useRowHoverCard } from "../useRowHoverCard";
import DocumentNoteIcon from "./DocumentNoteIcon";
import DrawerCloseButton from "./DrawerCloseButton";
import FilterMenu from "./FilterMenu";
import HoverCard from "./HoverCard";
import { BookmarkCard, DocumentCard, DocumentNoteCard, HighlightCard } from "./HoverCardContent";
import NoteRequest, { noteRequestText } from "./NoteRequest";
import { BookmarkIcon } from "./MarksLayer";
import { ReviewNotesIcon } from "./SendNotesDialog";
import listStyles from "./DocumentList.module.css";
import styles from "./MarksPanel.module.css";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/** What opening a mark should scroll to: a highlight, a heading, or (null) the document's top. */
export type MarkTarget = { highlight: string } | { heading: BookmarkHeading } | null;

/** A document's notes to send: the highlights shown, and whether its note on the whole is. */
export interface ReviewSelection {
  doc: DocumentMeta;
  highlights: readonly Highlight[];
  note: boolean;
}

const NOTHING_FOLDED: ReadonlySet<string> = new Set();

interface MarksPanelProps {
  /** The sidebar's Documents | Marks switch, shown in the header. */
  tabs: React.ReactNode;
  /** In a narrow window, where the sidebar is a drawer: closes it. */
  onCollapse?: () => void;
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
  /** Remove the note on a document as a whole. */
  onRemoveDocumentNote: (docId: string) => void;
  /** Marks of files in the workspace that no longer exist. */
  missing: readonly MissingMarks[];
  /** Every document in the workspace, to move a missing document's marks to. */
  allDocuments: readonly DocumentMeta[];
  onRelink: (recordId: string, docId: string) => void;
  onForget: (recordId: string) => void;
  /** Send review notes on these highlights (opens the Send dialog). */
  onCopyNotes: (selection: ReviewSelection[]) => void;
  /** Show only these states, e.g. the private marks the Send dialog counted; a new nonce asks again. */
  filterRequest?: { filter: readonly StateFilter[]; nonce: number } | null;
}

/**
 * The sidebar's Marks view: bookmarks, then highlights and notes, of every
 * listed document (the workspace, or the focused folder). Opening one goes
 * to it in the viewer. The open document's marks also show in its outline.
 */
export default function MarksPanel({
  tabs,
  onCollapse,
  documents,
  current,
  byDoc,
  located,
  onOpen,
  onRemoveHighlight,
  onRemoveBookmark,
  onRemoveDocumentNote,
  missing,
  allDocuments,
  onRelink,
  onForget,
  onCopyNotes,
  filterRequest = null,
}: MarksPanelProps): React.ReactElement {
  const [query, setQuery] = useState("");
  // The filter menu: the kinds of marks picked (Show) and the states; none picked shows all but resolved notes
  const [kinds, setKinds] = useState<ReadonlySet<MarkKind>>(new Set());
  // Only the open document: the list follows it as other documents open, shown as a chip above the filter
  const [openOnly, setOpenOnly] = useState(false);
  const scoped = useMemo(() => (openOnly ? (current === null ? [] : [current]) : documents), [openOnly, current, documents]);
  // The states picked in the filter; none picked shows all but resolved notes
  const [picked, setPicked] = useState<ReadonlySet<StateFilter>>(new Set());
  const states = shownStates(picked);
  // States are about highlights and notes: with only bookmarks shown, they don't apply
  const statesApply = (k: ReadonlySet<MarkKind>) => k.size === 0 || k.has("highlights");
  // A new request sets the filter (while rendering, as React suggests for state that follows a prop)
  const [seenRequest, setSeenRequest] = useState(filterRequest);
  if (filterRequest !== seenRequest) {
    setSeenRequest(filterRequest);
    if (filterRequest !== null) setPicked(new Set(filterRequest.filter));
  }
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const filterId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const rows = useMemo(
    () => buildMarkRows({ documents: scoped, byDoc, query, kinds, states, collapsed, located }),
    [scoped, byDoc, query, kinds, states, collapsed, located],
  );
  // What the view shows, folded documents included: the highlights Copy review notes copies, by document
  const copyable = useMemo(() => {
    const byDocShown = new Map<string, ReviewSelection>();
    for (const row of buildMarkRows({ documents: scoped, byDoc, query, kinds, states, collapsed: NOTHING_FOLDED, located })) {
      const entry = byDocShown.get(row.doc.id);
      // A note on the document is sent too: its comment, or a status change still to make
      if (row.kind === "note" && (row.note.text !== null || !row.done)) {
        byDocShown.set(row.doc.id, { doc: row.doc, highlights: entry?.highlights ?? [], note: true });
      }
      if (row.kind !== "highlight") continue;
      byDocShown.set(row.doc.id, { doc: row.doc, highlights: [...(entry?.highlights ?? []), row.highlight], note: entry?.note ?? false });
    }
    return byDocShown;
  }, [scoped, byDoc, query, kinds, states, located]);
  // How many of the listed documents' marks are of each kind and notes in each state, for the filter
  const { kindCounts, stateCounts } = useMemo(() => {
    const counts = new Map<StateFilter, number>();
    const add = (state: StateFilter) => counts.set(state, (counts.get(state) ?? 0) + 1);
    const kindsOf = { bookmarks: 0, highlights: 0 };
    for (const doc of scoped) {
      const marks = byDoc.get(doc.id);
      if (marks === undefined) continue;
      kindsOf.bookmarks += marks.bookmarks.length;
      kindsOf.highlights += marks.highlights.length + (marks.note === undefined ? 0 : 1);
      for (const h of marks.highlights) add(filterOf(h));
      if (marks.note !== undefined) add(noteFilterOf(marks.note, doc.meta?.status));
    }
    return { kindCounts: kindsOf, stateCounts: counts };
  }, [scoped, byDoc]);
  // The open document's marks, for the Scope option
  const openMarks = current === null ? undefined : byDoc.get(current.id);
  const openCount =
    openMarks === undefined ? 0 : openMarks.bookmarks.length + openMarks.highlights.length + (openMarks.note === undefined ? 0 : 1);
  const tabStop = (rows.some((r) => r.key === focusKey) ? focusKey : undefined) ?? rows[0]?.key;

  // Hover card: a document's title and location, a mark in full (rows cut them short)
  const { card, listProps: hoverProps, dismiss: dismissCard } = useRowHoverCard(() => true);
  useEffect(() => dismissCard(), [dismissCard, query, kinds, states]);
  const cardRow = card === null ? undefined : rows.find((r) => r.key === card.key);

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
    } else if (row.kind === "note") onOpen(row.doc.id, null);
    else if (row.kind === "bookmark") onOpen(row.doc.id, row.missing ? null : { heading: row.bookmark.heading });
    else onOpen(row.doc.id, row.unplaced ? null : { highlight: row.highlight.id });
  };

  const remove = (row: MarkRow) => {
    if (row.kind === "document") {
      if (row.bookmark !== undefined) onRemoveBookmark(row.doc.id, row.bookmark.id);
    } else if (row.kind === "note") onRemoveDocumentNote(row.doc.id);
    else if (row.kind === "bookmark") onRemoveBookmark(row.doc.id, row.bookmark.id);
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
  // (none while only the open document is shown: a missing file can't be open)
  const shownMissing = missing.filter(
    (m) =>
      !openOnly &&
      (kinds.size === 0 ||
        (kinds.has("highlights") && (m.note !== undefined || m.highlights.length > 0)) ||
        (kinds.has("bookmarks") && m.bookmarks.length > 0)) &&
      (q === "" ||
        m.location.toLowerCase().includes(q) ||
        `${m.note?.requestedStatus ?? ""}\n${m.note?.text ?? ""}`.toLowerCase().includes(q) ||
        m.highlights.some((h) => `${h.quote.exact}\n${h.note ?? ""}`.toLowerCase().includes(q)) ||
        m.bookmarks.some((b) => b.heading?.text.toLowerCase().includes(q))),
  );

  return (
    <div className={listStyles.container}>
      <header className={listStyles.header}>
        {tabs}
        {onCollapse !== undefined && (
          <div className={listStyles.headerActions}>
            <DrawerCloseButton direction="left" label="Hide document list" onClick={onCollapse} />
          </div>
        )}
      </header>

      {/* ── Only the open document: what the list is narrowed to, and ✕ ── */}
      {openOnly && (
        <div className={listStyles.focusBar}>
          <svg className={listStyles.focusIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 1.5h6l3 3v10h-9z" />
          </svg>
          <span
            className={listStyles.focusLabel}
            title={current === null ? undefined : `Showing only the marks of ${current.location}`}
          >
            {current === null ? "No document open" : current.title}
          </span>
          <button
            type="button"
            className={listStyles.focusClear}
            onClick={() => setOpenOnly(false)}
            aria-label="Show every document's marks"
            title="Show every document's marks"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

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
          {query && (
            <button type="button" className={listStyles.clearBtn} onClick={() => setQuery("")} aria-label="Clear filter">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <FilterMenu
          sections={[
            {
              id: "scope",
              heading: "Scope",
              options: [
                {
                  value: "open",
                  label: "Only the open document",
                  icon: <DocumentIcon />,
                  count: openCount,
                  checked: openOnly,
                },
              ],
            },
            {
              id: "kind",
              heading: "Show",
              options: [
                { value: "bookmarks", label: "Bookmarks", icon: <BookmarkIcon filled />, count: kindCounts.bookmarks },
                { value: "highlights", label: "Highlights and notes", icon: <HighlightIcon />, count: kindCounts.highlights },
              ].map((o) => ({ ...o, checked: kinds.has(o.value === "bookmarks" ? "bookmarks" : "highlights") })),
            },
            // Only while highlights and notes show: states don't apply to bookmarks
            ...(statesApply(kinds)
              ? [
                  {
                    id: "state",
                    heading: "State",
                    options: STATE_FILTERS.map(({ value, label }) => ({
                      value,
                      label,
                      icon: <NoteStateIcon kind={value} />,
                      count: stateCounts.get(value) ?? 0,
                      checked: picked.has(value),
                    })),
                  },
                ]
              : []),
          ]}
          active={(openOnly ? 1 : 0) + kinds.size + picked.size}
          onToggle={(section, value) => {
            if (section === "scope") {
              setOpenOnly(!openOnly);
              return;
            }
            if (section === "kind") {
              const kind = value === "bookmarks" || value === "highlights" ? value : null;
              if (kind === null) return;
              const next = new Set(kinds);
              if (next.has(kind)) next.delete(kind);
              else next.add(kind);
              setKinds(next);
              if (!statesApply(next)) setPicked(new Set());
              return;
            }
            const state = STATE_FILTERS.find((s) => s.value === value)?.value;
            if (state === undefined) return;
            const next = new Set(picked);
            if (next.has(state)) next.delete(state);
            else next.add(state);
            setPicked(next);
          }}
          onClear={() => {
            setOpenOnly(false);
            setKinds(new Set());
            setPicked(new Set());
          }}
          label="Filter marks"
          note={picked.size === 0 && statesApply(kinds) ? "Resolved: hidden unless picked" : undefined}
          buttonClassName={listStyles.toolBtn}
          activeClassName={listStyles.toolBtnOn}
          badgeClassName={listStyles.filterBadge}
        />
        <button
          type="button"
          className={styles.copyAll}
          onClick={() => onCopyNotes([...copyable.values()])}
          disabled={copyable.size === 0}
          aria-label="Send review notes on the notes shown"
          title="Send review notes on the notes shown"
        >
          <ReviewNotesIcon size={14} />
        </button>
      </div>

      {/* ── Marks ── */}
      <div className={listStyles.listBody} role="region" aria-label="Marks" onScroll={dismissCard}>
        {rows.length === 0 && shownMissing.length === 0 ? (
          <div className={listStyles.emptyArea}>
            {!hasAny ? (
              <>
                <p>No bookmarks or highlights yet.</p>
                <p className={styles.hint}>
                  Select text to highlight it, or press {IS_MAC ? "⌘D" : "Ctrl+D"} to bookmark the document.
                </p>
              </>
            ) : openOnly && query === "" && current === null ? (
              <p>No document open.</p>
            ) : openOnly && query === "" && !byDoc.has(current?.id ?? "") ? (
              <p>No marks in this document.</p>
            ) : query === "" ? (
              <p>No marks match the filters.</p>
            ) : (
              <p>No marks match "<strong>{query}</strong>".</p>
            )}
          </div>
        ) : (
          <ul
            ref={listRef}
            className={styles.list}
            role="tree"
            aria-label="Marks"
            onKeyDown={(e) => {
              // Moving between rows keeps the card (it follows focus); other keys put it away
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) dismissCard();
              onListKeyDown(e);
            }}
            {...hoverProps}
          >
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
        {card !== null && cardRow !== undefined && (
          <HoverCard anchor={card}>
            {cardRow.kind === "document" ? (
              <DocumentCard
                doc={cardRow.doc}
                bookmarked={cardRow.bookmark !== undefined}
                highlightCount={byDoc.get(cardRow.doc.id)?.highlights.length ?? 0}
                note={byDoc.get(cardRow.doc.id)?.note}
              />
            ) : cardRow.kind === "note" ? (
              <DocumentNoteCard doc={cardRow.doc} note={cardRow.note} rounds={byDoc.get(cardRow.doc.id)?.rounds} />
            ) : cardRow.kind === "bookmark" ? (
              <BookmarkCard doc={cardRow.doc} heading={cardRow.bookmark.heading.text} missing={cardRow.missing} />
            ) : (
              <HighlightCard
                doc={cardRow.doc}
                highlight={cardRow.highlight}
                unplaced={cardRow.unplaced}
                rounds={byDoc.get(cardRow.doc.id)?.rounds}
              />
            )}
          </HoverCard>
        )}
        {shownMissing.some((m) => m.branch === undefined) && (
          <MissingSection
            missing={shownMissing.filter((m) => m.branch === undefined)}
            documents={allDocuments}
            onRelink={onRelink}
            onForget={onForget}
          />
        )}
        {shownMissing.some((m) => m.branch !== undefined) && (
          <MissingSection
            onOtherBranches
            missing={shownMissing.filter((m) => m.branch !== undefined)}
            documents={allDocuments}
            onRelink={onRelink}
            onForget={onForget}
          />
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
        {row.summary !== "" && <span className={styles.summary}>{row.summary}</span>}
        {copyable && (
          <button
            type="button"
            className={styles.copyNotes}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onCopyNotes();
            }}
            aria-label={`Send review notes on ${row.doc.title}`}
            title="Send review notes"
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

  if (row.kind === "note") {
    const { note, done } = row;
    const request = note.requestedStatus === null ? "" : `${noteRequestText(note.requestedStatus, done)}. `;
    return (
      <li
        {...common}
        className={`${styles.markRow} ${styles.docNoteRow} ${selected ? styles.current : ""}`}
        aria-label={`Note on the document: ${request}${note.text ?? ""}`}
      >
        <span className={styles.docNoteIcon} aria-hidden="true">
          <DocumentNoteIcon size={14} />
        </span>
        <span className={styles.highlightBody}>
          {note.requestedStatus !== null && (
            <NoteRequest requested={note.requestedStatus} done={done} className={styles.request} iconClassName={styles.requestIcon} />
          )}
          {note.text !== null && (
            <span className={styles.note}>
              <NoteStateIcon kind={noteFilterOf(note, row.doc.meta?.status)} size={12} />
              <span className={styles.docNoteText}>{note.text}</span>
            </span>
          )}
          <NewReplies count={newReplies(note).length} />
        </span>
        {removeButton("Remove the note on the document")}
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
        {/* A note, or a bare highlight sent to the agent as "(no comment)" */}
        {(highlight.note !== null || highlight.private === false) && (
          <span className={styles.note}>
            <NoteStateIcon kind={noteIconOf(highlight)} size={12} />
            <span className={styles.noteText}>{highlight.note ?? "(no comment)"}</span>
          </span>
        )}
        <NewReplies count={newReplies(highlight).length} />
        {unplaced && <span className={styles.notFound}>Not found in the current text</span>}
      </span>
      {removeButton("Remove highlight")}
    </li>
  );
}

/** Replies to a note the user hasn't seen (docs/design/agent-integration.md): open the note to read them. */
function NewReplies({ count }: { count: number }): React.ReactElement | null {
  if (count === 0) return null;
  return <span className={styles.newReplies}>{count === 1 ? "New reply" : `${count} new replies`}</span>;
}

/** A page: the Scope section's open document. */
function DocumentIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M5.5 8h5M5.5 10.5h5" strokeLinecap="round" />
    </svg>
  );
}

/** A highlighted line: the Show section's highlights and notes. */
function HighlightIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      <rect x="1.5" y="5" width="13" height="6" rx="1" fill="var(--mark-yellow)" stroke="none" />
      <path d="M3 8h10" />
    </svg>
  );
}

// ─── Missing documents ───────────────────────────────────────────────────────

interface MissingSectionProps {
  missing: readonly MissingMarks[];
  /** The files are on other git branches, not gone: switching back shows them with their marks. */
  onOtherBranches?: boolean;
  documents: readonly DocumentMeta[];
  onRelink: (recordId: string, docId: string) => void;
  onForget: (recordId: string) => void;
}

/**
 * Marks of files that no longer exist (deleted, or moved and edited): moved
 * to the suggested document or one picked, or deleted. Nothing is deleted
 * without asking. Files on another branch are listed apart, with no
 * suggestion: their marks are fine where they are.
 */
function MissingSection({ missing, onOtherBranches = false, documents, onRelink, onForget }: MissingSectionProps): React.ReactElement {
  const headingId = onOtherBranches ? "folio-other-branches-heading" : "folio-missing-heading";
  return (
    <section className={styles.missingSection} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.missingHeading}>
        {onOtherBranches ? "On other branches" : "Missing documents"} ({missing.length})
      </h2>
      <p className={styles.missingHint}>
        {onOtherBranches
          ? "Their files are on another branch. Switch to it and they show again, with their marks."
          : "Their files were moved or deleted. Move the marks to a document, or delete them."}
      </p>
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
  const count = (marks.note === undefined ? 0 : 1) + marks.bookmarks.length + marks.highlights.length;
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
          {marks.note !== undefined && (
            <li className={styles.missingMark}>
              <span className={styles.docNoteIcon}>
                <DocumentNoteIcon size={14} />
              </span>
              <span className={styles.highlightBody}>
                {marks.note.requestedStatus !== null && (
                  <NoteRequest requested={marks.note.requestedStatus} done={false} className={styles.request} iconClassName={styles.requestIcon} />
                )}
                {marks.note.text !== null && <span className={styles.noteText}>{marks.note.text}</span>}
              </span>
            </li>
          )}
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
          {marks.branch !== undefined && <span className={styles.onBranch}>On branch {marks.branch}</span>}
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
              if (e.key === "Escape") {
                // Only the picker: the sidebar drawer stays open
                e.preventDefault();
                setMode("idle");
              }
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
