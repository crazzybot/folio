import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchDocuments } from "../api";
import { documentName, titleIsName } from "../docName";
import { documentNumber, titleWithoutNumber } from "../docNumber";
import { buildDocumentTree, foldersContaining } from "../documentTree";
import type { TreeNode } from "../documentTree";
import { slugify } from "../slug";
import { hasFilters, NO_FILTERS, toggleFilter } from "../metaFilter";
import type { FilterOption, MetaFilters } from "../metaFilter";
import { isRetired, statusText } from "../status";
import { branchSentence, changeSentence, isOnBase, repositoryAtFolder, repositoryOf } from "../git";
import { readSentence, readStateOf } from "../reads";
import type { ReadState } from "../reads";
import { useRowHoverCard } from "../useRowHoverCard";
import type {
  DocumentMeta,
  DocumentNote,
  DocumentRead,
  GitChange,
  GitLastCommit,
  GitRepository,
  GitState,
  Heading,
  SearchMatch,
  SearchResult,
} from "../types";
import DrawerCloseButton from "./DrawerCloseButton";
import FilterMenu from "./FilterMenu";
import { BranchIcon, WorktreeIcon } from "./GitIcons";
import HoverCard from "./HoverCard";
import { DocumentCard, FolderCard } from "./HoverCardContent";
import MarkdownIcon from "./MarkdownIcon";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentList.module.css";
import { getItem, setItem } from "../storage";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Searching document text starts at this many characters, after a pause in typing
const MIN_CONTENT_QUERY = 2;
const CONTENT_SEARCH_DELAY_MS = 200;
// Matching headings listed under a document before "N more"
const MAX_HEADING_ROWS = 3;

const EXPANDED_KEY = "folio.expandedFolders";
// Remembered expanded folders, most recent last; old workspaces' folders age out
const MAX_REMEMBERED_FOLDERS = 500;
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const FULL_TEXT_SHORTCUT = IS_MAC ? "⇧⌘F" : "Ctrl+Shift+F";


function loadExpanded(): Set<string> {
  try {
    const saved: unknown = JSON.parse(getItem(EXPANDED_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(keys: ReadonlySet<string>): void {
  setItem(EXPANDED_KEY, JSON.stringify([...keys].slice(-MAX_REMEMBERED_FOLDERS)));
}

/**
 * One row of the sidebar list. All three views (folder tree, flat list,
 * search results) are a list of rows, so keyboard navigation is shared:
 * ↑ ↓ Home End move, → ← expand / collapse folders or go to the parent,
 * Enter / Space open. `parent` is the key of the row → ← return to.
 */
type Row = { key: string; level: number; parent: string | null } & (
  | { kind: "folder"; folderKey: string; label: string; expanded: boolean }
  | {
      kind: "document";
      doc: DocumentMeta;
      /** Its file name's number ("0015") or well-known name ("AGENTS"), shown before the title; null when neither. */
      prefix: string | null;
      /** Its title, without what the prefix already says. */
      title: string;
      matchCount: number | null;
      onOpen: () => void;
    }
  | { kind: "heading"; heading: Heading; onOpen: () => void }
  | { kind: "match"; match: SearchMatch; onOpen: () => void }
  | { kind: "more"; text: string }
);

/**
 * One document in the results. Title / filename and heading matches are
 * found instantly from the document list; text matches only when searching
 * document text.
 */
interface ResultEntry {
  doc: DocumentMeta;
  titleMatch: boolean;
  headings: Heading[];
  content: SearchResult | undefined;
}

interface DocumentListProps {
  documents: DocumentMeta[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  /** Open a document; `occurrence` is the search match to scroll to, if any. */
  onSelect: (id: string, occurrence?: number) => void;
  /** Open a document at a heading (by its anchor slug). */
  onOpenSection: (id: string, anchor: string) => void;
  /** The query whose matches the viewer highlights ("" when none). */
  onSearchQueryChange?: (query: string) => void;
  /** Group the list by folder (sidebar header toggle; also in Settings). */
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  /** Search document text too (search box toggle, ⇧⌘F; also in Settings). */
  fullText: boolean;
  onFullTextChange: (on: boolean) => void;
  /** The folder the list is focused on ("docs/api"; `documents` are already narrowed to it), or null. */
  focus: string | null;
  onFocusChange: (folder: string | null) => void;
  /** The user's notes on documents as a whole, by document id (hover cards). */
  documentNotes?: ReadonlyMap<string, DocumentNote>;
  /** Status and tag filters; `documents` are already narrowed by them. */
  filters?: MetaFilters;
  /** What the filter menu offers, counted within the focused folder. */
  filterOptions?: { statuses: FilterOption[]; tags: FilterOption[] };
  onFiltersChange?: (filters: MetaFilters) => void;
  /** Number of highlights by document id (documents without any are absent). */
  highlightCounts?: ReadonlyMap<string, number>;
  /** Documents bookmarked as a whole. */
  bookmarkedIds?: ReadonlySet<string>;
  /** The workspace's git repositories (desktop): folder icons and hover cards. */
  git?: GitState | null;
  /** Documents changed on the branch, by id (desktop): letters and hover cards; null without git. */
  branchChanges?: ReadonlyMap<string, GitChange> | null;
  /** Documents changed on the branch in the focused folder: the filter menu's count. */
  branchCount?: number;
  /** Each document's read record, by id: new and changed markers, hover cards. */
  reads?: ReadonlyMap<string, DocumentRead>;
  /** Documents that are new or changed. */
  unreadIds?: ReadonlySet<string>;
  /** Unread documents in the focused folder: the filter menu's Unread count. */
  unreadCount?: number;
  onMarkRead?: (docId: string) => void;
  onMarkUnread?: (docId: string) => void;
  /** Mark every document under a folder read. */
  onMarkFolderRead?: (folder: string) => void;
  /** The sidebar's Documents | Marks switch, shown in place of the title. */
  tabs?: React.ReactNode;
  /** In a narrow window, where the sidebar is a drawer: closes it. */
  onCollapse?: () => void;
}

type ContentSearch =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | ContentSearchResult;

/** What the last text search returned. */
type ContentSearchResult =
  | { status: "done"; query: string; results: ReadonlyMap<string, SearchResult> }
  | { status: "error"; query: string };

export default function DocumentList({
  documents,
  selectedId,
  loading,
  error,
  onSelect,
  onOpenSection,
  onSearchQueryChange,
  grouped,
  onGroupedChange,
  fullText,
  onFullTextChange,
  focus,
  onFocusChange,
  documentNotes = NO_NOTES,
  filters = NO_FILTERS,
  filterOptions = NO_OPTIONS,
  onFiltersChange,
  highlightCounts = NO_COUNTS,
  bookmarkedIds = NO_IDS,
  git = null,
  branchChanges = null,
  branchCount = 0,
  reads = NO_READS,
  unreadIds = NO_IDS,
  unreadCount = 0,
  onMarkRead,
  onMarkUnread,
  onMarkFolderRead,
  tabs,
  onCollapse,
}: DocumentListProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [lastContentSearch, setLastContentSearch] = useState<ContentSearchResult | null>(null);
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  const chooseFullText = onFullTextChange;

  // ⇧⌘F / Ctrl+Shift+F: search document text, as in VS Code (also the
  // desktop Edit menu's Search Document Text…)
  useEffect(() => {
    const searchText = () => {
      chooseFullText(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchText();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = window.markdownApi?.onFindCommand((command) => {
      if (command === "search-text") searchText();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [chooseFullText]);

  // Search document text once typing pauses. Also re-runs when the document
  // list changes (live reload), so results follow edits.
  // Until results for this query arrive it's "searching"; a re-run for the
  // same query (live reload) keeps showing the previous results meanwhile.
  const searchingText = fullText && trimmed.length >= MIN_CONTENT_QUERY;
  const contentSearch: ContentSearch = !searchingText
    ? { status: "idle" }
    : lastContentSearch !== null && lastContentSearch.query === trimmed
      ? lastContentSearch
      : { status: "searching", query: trimmed };
  useEffect(() => {
    if (!searchingText) {
      onSearchQueryChange?.("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchDocuments(trimmed)
        .then((results) => {
          if (cancelled) return;
          setLastContentSearch({ status: "done", query: trimmed, results: new Map(results.map((r) => [r.id, r])) });
          onSearchQueryChange?.(trimmed);
        })
        .catch(() => {
          if (!cancelled) setLastContentSearch({ status: "error", query: trimmed });
        });
    }, CONTENT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchingText, trimmed, documents, onSearchQueryChange]);

  const contentResults = fullText && contentSearch.status === "done" ? contentSearch.results : null;

  // Title / filename and heading matches show instantly; text matches join
  // once the search returns. Ranked: title, then heading, then text matches.
  const results = useMemo((): ResultEntry[] => {
    const q = trimmed.toLowerCase();
    if (!q) return documents.map((doc) => ({ doc, titleMatch: false, headings: [], content: undefined }));
    const entries: ResultEntry[] = [];
    for (const doc of documents) {
      const titleMatch = doc.title.toLowerCase().includes(q) || doc.filename.toLowerCase().includes(q);
      // The h1 that is the document's title is already matched as the title
      const headings = doc.headings.filter(
        (h) => h.text.toLowerCase().includes(q) && !(h.level === 1 && h.text === doc.title),
      );
      const content = contentResults?.get(doc.id);
      if (titleMatch || headings.length > 0 || content !== undefined) {
        entries.push({ doc, titleMatch, headings, content });
      }
    }
    const rank = (e: ResultEntry) => (e.titleMatch ? 0 : e.headings.length > 0 ? 1 : 2);
    return entries.sort((a, b) => rank(a) - rank(b)); // stable: list order within a rank
  }, [documents, trimmed, contentResults]);

  // Opening a result goes to its first text match, else its first matching heading
  const openEntry = (entry: ResultEntry) => {
    const heading = entry.headings[0];
    if (entry.content !== undefined) onSelect(entry.doc.id, 0);
    else if (!entry.titleMatch && heading !== undefined) onOpenSection(entry.doc.id, slugify(heading.text));
    else onSelect(entry.doc.id);
  };

  // Text search covers the whole workspace: count only the documents listed
  const listedContent = results.flatMap((entry) => (entry.content === undefined ? [] : [entry.content]));
  const totalMatches = listedContent.reduce((sum, r) => sum + r.matchCount, 0);

  // ── Group by folder (shown while not searching) ────────────────────────────
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(loadExpanded);
  const tree = useMemo(() => buildDocumentTree(documents), [documents]);
  const prefixes = useMemo(() => {
    const byId = new Map<string, { prefix: string; title: string }>();
    for (const doc of documents) {
      const number = documentNumber(doc.filename);
      if (number !== null) {
        byId.set(doc.id, { prefix: number, title: titleWithoutNumber(doc.title, number) });
        continue;
      }
      // A title that only repeats the name ("Changelog") says it already
      const name = documentName(doc.filename);
      if (name !== null && !titleIsName(doc.title, name)) byId.set(doc.id, { prefix: name, title: doc.title });
    }
    return byId;
  }, [documents]);
  const showTree = grouped && trimmed === "";

  const chooseGrouped = onGroupedChange;

  const setFolderExpanded = useCallback((keys: readonly string[], open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        // Re-adding moves it to the end: the most recently used survive the cap
        next.delete(key);
        if (open) next.add(key);
      }
      saveExpanded(next);
      return next;
    });
  }, []);

  // The open document's folders expand, so it's visible in the tree. Only when
  // the document (or the tree) changes: collapsing its folder afterwards must
  // stick. Done while rendering, when those change, rather than in an effect.
  const selectedLocation = documents.find((doc) => doc.id === selectedId)?.location ?? null;
  const [revealedFor, setRevealedFor] = useState<{ showTree: boolean; location: string | null; tree: typeof tree } | null>(
    null,
  );
  if (
    revealedFor === null ||
    revealedFor.showTree !== showTree ||
    revealedFor.location !== selectedLocation ||
    revealedFor.tree !== tree
  ) {
    setRevealedFor({ showTree, location: selectedLocation, tree });
    if (showTree && selectedLocation !== null) {
      const keys = foldersContaining(tree, selectedLocation);
      if (keys.some((key) => !expanded.has(key))) setFolderExpanded(keys, true);
    }
  }

  // Folders holding a document with highlights, marked while collapsed
  const markedFolders = useMemo(() => {
    const folders = new Set<string>();
    for (const doc of documents) {
      if (!highlightCounts.has(doc.id)) continue;
      const parts = doc.location.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    return folders;
  }, [documents, highlightCounts]);

  // How many unread documents each folder holds, at any depth
  const unreadByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      if (!unreadIds.has(doc.id)) continue;
      const parts = doc.location.split("/");
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join("/");
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
      }
    }
    return counts;
  }, [documents, unreadIds]);

  // ── Rows ───────────────────────────────────────────────────────────────────
  const rows: Row[] = [];
  const documentRow = (
    doc: DocumentMeta,
    level: number,
    parent: string | null,
    matchCount: number | null,
    onOpen: () => void,
  ): Row => {
    const { prefix = null, title = doc.title } = prefixes.get(doc.id) ?? {};
    return { kind: "document", key: `d:${doc.id}`, level, parent, doc, prefix, title, matchCount, onOpen };
  };

  if (showTree) {
    const addNodes = (nodes: readonly TreeNode[], level: number, parent: string | null) => {
      for (const node of nodes) {
        if (node.kind === "document") {
          rows.push(documentRow(node.doc, level, parent, null, () => onSelect(node.doc.id)));
          continue;
        }
        const key = `f:${node.key}`;
        const open = expanded.has(node.key);
        rows.push({ kind: "folder", key, level, parent, folderKey: node.key, label: node.label, expanded: open });
        if (open) addNodes(node.children, level + 1, key);
      }
    };
    addNodes(tree, 0, null);
  } else {
    for (const entry of results) {
      const { doc, content } = entry;
      const key = `d:${doc.id}`;
      rows.push(documentRow(doc, 0, null, content?.matchCount ?? null, () => openEntry(entry)));
      // Text matches already include heading lines, so they replace the heading rows
      const headings = content === undefined ? entry.headings : [];
      headings.slice(0, MAX_HEADING_ROWS).forEach((heading, i) => {
        rows.push({
          kind: "heading",
          key: `h:${doc.id}:${i}`,
          level: 1,
          parent: key,
          heading,
          onOpen: () => onOpenSection(doc.id, slugify(heading.text)),
        });
      });
      if (headings.length > MAX_HEADING_ROWS) {
        rows.push({ kind: "more", key: `mh:${doc.id}`, level: 1, parent: key, text: `${headings.length - MAX_HEADING_ROWS} more headings` });
      }
      content?.matches.forEach((match) => {
        rows.push({
          kind: "match",
          key: `m:${doc.id}:${match.occurrence}`,
          level: 1,
          parent: key,
          match,
          onOpen: () => onSelect(doc.id, match.occurrence),
        });
      });
      if (content !== undefined && content.matchCount > content.matches.length) {
        rows.push({
          kind: "more",
          key: `mm:${doc.id}`,
          level: 1,
          parent: key,
          text: `${content.matchCount - content.matches.length} more in this document`,
        });
      }
    }
  }

  // ── Keyboard navigation (one tab stop, arrow keys inside) ──────────────────
  const listRef = useRef<HTMLUListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  const focusable = rows.filter((row) => row.kind !== "more");
  const tabStop =
    (focusKey !== null && rowsByKey.has(focusKey) ? focusKey : undefined) ??
    focusable.find((row) => row.kind === "document" && row.doc.id === selectedId)?.key ??
    focusable[0]?.key;

  const rowElements = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
  const focusRow = (key: string | undefined) => {
    const el = rowElements().find((e) => e.dataset["row"] === key);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  };

  // ── Hover card: a row's full title, location and marks ─────────────────────
  const { card, listProps: hoverProps, dismiss: dismissCard } = useRowHoverCard((key) => {
    const kind = rowsByKey.get(key)?.kind;
    return kind === "document" || kind === "folder";
  });
  // The rows change under it as the search narrows
  useEffect(() => dismissCard(), [dismissCard, trimmed]);

  const cardRow = card === null ? undefined : rowsByKey.get(card.key);
  const cardCommit = useLastCommit(
    cardRow?.kind === "document" && repositoryOf(git, cardRow.doc.location) !== null ? cardRow.doc.id : null,
    git,
  );

  const activate = (row: Row) => {
    if (row.kind === "folder") setFolderExpanded([row.folderKey], !row.expanded);
    else if (row.kind !== "more") row.onOpen();
  };

  function onListKeyDown(e: React.KeyboardEvent) {
    const elements = rowElements();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const row = rowsByKey.get(elements[index]?.dataset["row"] ?? "");
    if (index < 0 || row === undefined) return;
    const at = (i: number) => elements[Math.max(0, Math.min(elements.length - 1, i))]?.dataset["row"];
    switch (e.key) {
      case "ArrowDown":
        focusRow(at(index + 1));
        break;
      case "ArrowUp":
        // From the first row, back to the search box
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
        if (row.kind !== "folder") return;
        if (row.expanded) focusRow(at(index + 1));
        else setFolderExpanded([row.folderKey], true);
        break;
      case "ArrowLeft":
        if (row.kind === "folder" && row.expanded) setFolderExpanded([row.folderKey], false);
        else if (row.parent !== null) focusRow(row.parent);
        else return;
        break;
      case "Enter":
      case " ":
        dismissCard();
        activate(row);
        break;
      case "Escape":
        dismissCard();
        if (focus === null) return;
        onFocusChange(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // Keep the open document in view in the list
  useEffect(() => {
    if (selectedId === null) return;
    listRef.current
      ?.querySelector(`[data-row="d:${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, showTree]);

  const groupLabel = grouped ? "Show as a flat list" : "Group by folder";

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <header className={styles.header}>
        {tabs ?? <h1 className={styles.heading}>Documents</h1>}
        {onCollapse !== undefined && (
          <div className={styles.headerActions}>
            <DrawerCloseButton direction="left" label="Hide document list" onClick={onCollapse} />
          </div>
        )}
      </header>

      {/* ── Focused folder ── */}
      {focus !== null && (
        <div className={styles.focusBar}>
          <svg className={styles.focusIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
            <path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z" />
          </svg>
          <span className={styles.focusLabel} title={`Showing only documents in ${focus}`}>
            {focus.split("/").join(" / ")}
          </span>
          <button
            type="button"
            className={styles.focusClear}
            onClick={() => onFocusChange(null)}
            aria-label="Show all documents"
            title="Show all documents"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Search, with the list's filter and Group by folder beside it (as the Marks view's) ── */}
      <div className={styles.searchWrapper}>
        <label htmlFor={searchId} className={styles.srOnly}>
          Search documents
        </label>
        <div className={styles.searchRow}>
          <div className={styles.searchInputWrapper}>
            <svg
              className={styles.searchIcon}
              width="14"
              height="14"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              id={searchId}
              type="search"
              className={styles.searchInput}
              ref={inputRef}
              placeholder={fullText ? "Search text…" : "Search titles…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter opens the first result; ↓ moves into the list
                const first = results[0];
                if (e.key === "Enter" && trimmed !== "" && first !== undefined) {
                  e.preventDefault();
                  openEntry(first);
                } else if (e.key === "ArrowDown" && tabStop !== undefined) {
                  e.preventDefault();
                  focusRow(tabStop);
                }
              }}
              aria-label={fullText ? "Search document titles, headings and text" : "Search document titles and headings"}
              aria-describedby={`${searchId}-status`}
            />
            <button
              type="button"
              className={`${styles.fullTextBtn} ${fullText ? styles.fullTextBtnOn : ""}`}
              onClick={() => chooseFullText(!fullText)}
              aria-pressed={fullText}
              aria-label={`Search document text (${FULL_TEXT_SHORTCUT})`}
              title={`Search document text (${FULL_TEXT_SHORTCUT})`}
            >
              {/* A page with lines of text */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
                <path d="M3.5 1.5h6l3 3v10h-9z" strokeLinejoin="round" />
                <path d="M5.5 7.5h5M5.5 10h5M5.5 12.5h3" strokeLinecap="round" />
              </svg>
            </button>
            {query && (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                  <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <div className={styles.searchTools}>
            {onFiltersChange !== undefined &&
              (filterOptions.statuses.length > 0 ||
                filterOptions.tags.length > 0 ||
                unreadCount > 0 ||
                branchCount > 0 ||
                hasFilters(filters)) && (
                <FilterMenu
                  sections={[
                    {
                      id: "read",
                      heading: "Read",
                      options:
                        unreadCount > 0 || filters.unread
                          ? [{ value: "unread", label: "Unread", count: unreadCount, checked: filters.unread }]
                          : [],
                    },
                    {
                      id: "branch",
                      heading: "Git",
                      options:
                        branchCount > 0 || filters.branch
                          ? [{ value: "branch", label: "Changed on this branch", count: branchCount, checked: filters.branch }]
                          : [],
                    },
                    {
                      id: "status",
                      heading: "Status",
                      options: filterOptions.statuses.map((o) => ({
                        value: o.value,
                        label: capitalise(o.value),
                        icon: <StatusIcon status={o.value} />,
                        count: o.count,
                        checked: filters.statuses.includes(o.value),
                      })),
                    },
                    {
                      id: "tag",
                      heading: "Tags",
                      searchPlaceholder: "Filter tags…",
                      options: filterOptions.tags.map((o) => ({
                        value: o.value,
                        label: `#${o.value}`,
                        count: o.count,
                        checked: filters.tags.includes(o.value),
                      })),
                    },
                  ]}
                  active={filters.statuses.length + filters.tags.length + (filters.unread ? 1 : 0) + (filters.branch ? 1 : 0)}
                  onToggle={(section, value) =>
                    onFiltersChange(
                      section === "read"
                        ? { ...filters, unread: !filters.unread }
                        : section === "branch"
                          ? { ...filters, branch: !filters.branch }
                          : toggleFilter(filters, section === "status" ? "status" : "tag", value),
                    )
                  }
                  onClear={() => onFiltersChange(NO_FILTERS)}
                  label="Filter by status and tags"
                  buttonClassName={styles.toolBtn}
                  activeClassName={styles.toolBtnOn}
                  badgeClassName={styles.filterBadge}
                />
              )}
            <button
              type="button"
              className={`${styles.toolBtn} ${grouped ? styles.toolBtnOn : ""}`}
              onClick={() => chooseGrouped(!grouped)}
              aria-pressed={grouped}
              aria-label="Group by folder"
              title={groupLabel}
            >
              {/* A folder tree */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
                <path d="M1.5 3.5h4l1 1h4v3h-9z" />
                <path d="M4 7.5v5h3M4 10h3" strokeLinecap="round" />
                <path d="M7.5 9h7v2.5h-7zM7.5 11.5h7V14h-7z" />
              </svg>
            </button>
          </div>
        </div>
        {onFiltersChange !== undefined && hasFilters(filters) && (
          <div className={styles.filterChips} role="group" aria-label="Filters">
            {filters.unread && (
              <button
                type="button"
                className={styles.chip}
                onClick={() => onFiltersChange({ ...filters, unread: false })}
                aria-label="Remove filter: Unread"
                title="Remove filter"
              >
                Unread
                <span className={styles.chipRemove} aria-hidden="true">
                  ×
                </span>
              </button>
            )}
            {filters.branch && (
              <button
                type="button"
                className={styles.chip}
                onClick={() => onFiltersChange({ ...filters, branch: false })}
                aria-label="Remove filter: Changed on this branch"
                title="Remove filter"
              >
                Changed on branch
                <span className={styles.chipRemove} aria-hidden="true">
                  ×
                </span>
              </button>
            )}
            {filters.statuses.map((status) => (
              <button
                key={`s:${status}`}
                type="button"
                className={styles.chip}
                onClick={() => onFiltersChange(toggleFilter(filters, "status", status))}
                aria-label={`Remove filter: ${status}`}
                title="Remove filter"
              >
                <StatusIcon status={status} className={styles.chipIcon} />
                {status}
                <span className={styles.chipRemove} aria-hidden="true">
                  ×
                </span>
              </button>
            ))}
            {filters.tags.map((tag) => (
              <button
                key={`t:${tag}`}
                type="button"
                className={styles.chip}
                onClick={() => onFiltersChange(toggleFilter(filters, "tag", tag))}
                aria-label={`Remove filter: #${tag}`}
                title="Remove filter"
              >
                #{tag}
                <span className={styles.chipRemove} aria-hidden="true">
                  ×
                </span>
              </button>
            ))}
            <button type="button" className={`${styles.linkBtn} ${styles.chipsClear}`} onClick={() => onFiltersChange(NO_FILTERS)}>
              Clear
            </button>
          </div>
        )}
        <p id={`${searchId}-status`} className={styles.searchStatus} aria-live="polite">
          {fullText && contentSearch.status === "searching" && "Searching…"}
          {fullText && contentSearch.status === "error" && "Couldn't search document text"}
          {contentResults !== null &&
            (totalMatches === 0
              ? "No matches in document text"
              : `${totalMatches} ${totalMatches === 1 ? "match" : "matches"} in ${listedContent.length} ${
                  listedContent.length === 1 ? "document" : "documents"
                }`)}
        </p>
      </div>

      {/* ── List body ── */}
      <div className={styles.listBody} role="region" aria-label="Document entries" onScroll={() => dismissCard()}>
        {loading && (
          <div className={styles.statusArea} aria-live="polite" aria-busy="true">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Loading documents…</span>
          </div>
        )}

        {!loading && error !== null && (
          <div className={styles.errorArea} role="alert">
            <p className={styles.errorMessage}>⚠ {error}</p>
          </div>
        )}

        {!loading && error === null && rows.length === 0 && !(fullText && contentSearch.status === "searching") && (
          <div className={styles.emptyArea}>
            {!query && hasFilters(filters) && onFiltersChange !== undefined ? (
              <>
                <p>No documents match these filters.</p>
                <button type="button" className={styles.linkBtn} onClick={() => onFiltersChange(NO_FILTERS)}>
                  Clear filters
                </button>
              </>
            ) : !query && focus !== null ? (
              <>
                <p>No documents in {focus}.</p>
                <button type="button" className={styles.linkBtn} onClick={() => onFocusChange(null)}>
                  Show all documents
                </button>
              </>
            ) : !query ? (
              <p>No documents found.</p>
            ) : fullText ? (
              <p>No documents match "<strong>{query}</strong>".</p>
            ) : (
              <>
                <p>No titles or headings match "<strong>{query}</strong>".</p>
                <button type="button" className={styles.linkBtn} onClick={() => chooseFullText(true)}>
                  Search document text
                </button>
              </>
            )}
          </div>
        )}

        {!loading && error === null && rows.length > 0 && (
          <ul
            ref={listRef}
            className={styles.list}
            role={showTree ? "tree" : "listbox"}
            aria-label="Documents"
            onKeyDown={onListKeyDown}
            {...hoverProps}
          >
            {rows.map((row) => (
              <RowItem
                key={row.key}
                row={row}
                tree={showTree}
                query={trimmed}
                selected={row.kind === "document" && row.doc.id === selectedId}
                tabStop={row.key === tabStop}
                onFocus={() => setFocusKey(row.key)}
                onActivate={() => activate(row)}
                onFocusFolder={onFocusChange}
                repository={
                  row.kind === "folder" ? repositoryAtFolder(git, row.folderKey, row.label.split(FOLDER_SEPARATOR).length) : null
                }
                readState={row.kind === "document" ? readStateOf(reads.get(row.doc.id)) : "read"}
                change={row.kind === "document" ? (branchChanges?.get(row.doc.id) ?? null) : null}
                unread={row.kind === "folder" ? (unreadByFolder.get(row.folderKey) ?? 0) : 0}
                onMarkRead={onMarkRead}
                onMarkUnread={onMarkUnread}
                onMarkFolderRead={onMarkFolderRead}
                bookmarked={row.kind === "document" && bookmarkedIds.has(row.doc.id)}
                highlightCount={
                  row.kind === "document"
                    ? (highlightCounts.get(row.doc.id) ?? 0)
                    : row.kind === "folder" && markedFolders.has(row.folderKey)
                      ? 1
                      : 0
                }
              />
            ))}
          </ul>
        )}
      </div>
      {card !== null && (cardRow?.kind === "document" || cardRow?.kind === "folder") && (
        <HoverCard anchor={card}>
          {cardRow.kind === "document" ? (
            <DocumentCard
              doc={cardRow.doc}
              bookmarked={bookmarkedIds.has(cardRow.doc.id)}
              highlightCount={highlightCounts.get(cardRow.doc.id) ?? 0}
              note={documentNotes.get(cardRow.doc.id)}
              read={readSentence(reads.get(cardRow.doc.id))}
              change={branchChanges?.get(cardRow.doc.id) ?? null}
              commit={cardCommit}
            />
          ) : (
            <FolderCard
              folder={cardRow.folderKey}
              label={cardRow.label}
              documents={documents}
              highlightCounts={highlightCounts}
              repository={repositoryOf(git, cardRow.folderKey)}
              unread={unreadByFolder.get(cardRow.folderKey) ?? 0}
            />
          )}
        </HoverCard>
      )}
    </div>
  );
}

/**
 * The last commit that touched `docId` (desktop, in a repository), for its
 * hover card. Asked for when the card opens; kept per document until the
 * git state changes (a commit, a checkout), so hovering again doesn't run
 * git again.
 */
function useLastCommit(docId: string | null, git: GitState | null): GitLastCommit | null {
  const [known, setKnown] = useState<{ git: GitState | null; commits: ReadonlyMap<string, GitLastCommit | null> }>({
    git,
    commits: new Map(),
  });
  const commits = known.git === git ? known.commits : NO_COMMITS;
  const fetched = docId !== null && commits.has(docId);

  useEffect(() => {
    const api = window.markdownApi;
    if (docId === null || fetched || !api) return;
    let live = true;
    api.git.lastCommit(docId).then(
      (commit) => {
        if (!live) return;
        setKnown((prev) => ({ git, commits: new Map(prev.git === git ? prev.commits : []).set(docId, commit) }));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [docId, fetched, git]);

  return docId === null ? null : (commits.get(docId) ?? null);
}

// ─── Rows ────────────────────────────────────────────────────────────────────

// Between the folders of a merged chain in a row's label (documentTree.ts)
const FOLDER_SEPARATOR = " / ";

/**
 * After a nested repository's folder: a worktree icon for a linked worktree,
 * a branch icon when it's off its base branch. Nothing on the base branch.
 */
function RepositoryIcon({ repository }: { repository: GitRepository }): React.ReactElement | null {
  const worktree = repository.mainCheckout !== null;
  if (!worktree && isOnBase(repository)) return null;
  const label = `${worktree ? "Worktree, " : ""}${branchSentence(repository).toLowerCase()}`;
  return (
    <span className={styles.folderBranch} role="img" aria-label={label}>
      {worktree ? <WorktreeIcon size={12} /> : <BranchIcon size={12} />}
    </span>
  );
}

// Tree indentation: per level, plus the chevron's width before documents
const INDENT = 12;
const CHEVRON = 16;
const TREE_PADDING = 8;

interface RowItemProps {
  row: Row;
  /** Rendered in the folder tree (indented treeitems) rather than a listbox. */
  tree: boolean;
  query: string;
  selected: boolean;
  tabStop: boolean;
  onFocus: () => void;
  onActivate: () => void;
  /** Focus on Folder, from a folder row's button or (desktop) context menu. */
  onFocusFolder: (folder: string) => void;
  /** A document's highlights; for a folder, more than 0 when something inside has any. */
  highlightCount: number;
  /** A document bookmarked as a whole. */
  bookmarked: boolean;
  /** For a folder: the nested git repository whose root it is, if any. */
  repository: GitRepository | null;
  /** For a document: new, changed or read. */
  readState: ReadState;
  /** For a document: how it changed on the git branch, if it did. */
  change: GitChange | null;
  /** For a folder: how many documents under it are unread. */
  unread: number;
  onMarkRead: ((docId: string) => void) | undefined;
  onMarkUnread: ((docId: string) => void) | undefined;
  onMarkFolderRead: ((folder: string) => void) | undefined;
}

function RowItem({
  row,
  tree,
  query,
  selected,
  tabStop,
  onFocus,
  onActivate,
  onFocusFolder,
  highlightCount,
  bookmarked,
  repository,
  readState,
  change,
  unread,
  onMarkRead,
  onMarkUnread,
  onMarkFolderRead,
}: RowItemProps): React.ReactElement {
  if (row.kind === "more") {
    return (
      <li className={styles.moreMatches} role="presentation" aria-hidden="true">
        {row.text}
      </li>
    );
  }

  const common = {
    "data-row": row.key,
    tabIndex: tabStop ? 0 : -1,
    onFocus,
    onClick: onActivate,
    role: tree ? "treeitem" : "option",
    ...(tree ? { "aria-level": row.level + 1 } : {}),
  };

  if (row.kind === "folder") {
    return (
      <li
        {...common}
        className={`${styles.entry} ${styles.folderEntry}`}
        style={{ paddingLeft: TREE_PADDING + row.level * INDENT }}
        aria-expanded={row.expanded}
        aria-selected={false}
        onContextMenu={(e) => {
          // Desktop: a native menu (Focus on Folder, Reveal in Finder…);
          // the browser keeps its own menu
          const api = window.markdownApi;
          if (!api) return;
          e.preventDefault();
          const folder = row.folderKey;
          void api.showFolderMenu(folder, unread > 0).then((choice) => {
            if (choice === "focus") onFocusFolder(folder);
            if (choice === "mark-read") onMarkFolderRead?.(folder);
          });
        }}
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
        <span className={styles.entryTitle}>{row.label}</span>
        {repository !== null && <RepositoryIcon repository={repository} />}
        {unread > 0 && (
          <span className={styles.folderUnread} aria-label={`${unread} unread`}>
            {unread}
          </span>
        )}
        {!row.expanded && highlightCount > 0 && (
          <span className={styles.folderMarks} aria-label="Has highlights" />
        )}
        {/* Mouse shortcut; the keyboard has the breadcrumb and context menu */}
        <button
          type="button"
          className={styles.rowAction}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onFocusFolder(row.folderKey);
          }}
          aria-label={`Focus on ${row.folderKey}`}
          title="Focus on folder"
        >
          {/* A target */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        </button>
      </li>
    );
  }

  if (row.kind === "document") {
    const { doc, prefix, title, matchCount } = row;
    const status = doc.meta?.status ?? null;
    const tags = doc.meta?.tags ?? [];
    const described =
      (status === null ? "" : ` — ${statusText({ status, statusDetail: doc.meta?.statusDetail ?? null })}`) +
      (tags.length === 0 ? "" : ` — tags ${tags.join(", ")}`);
    const matches = matchCount === null ? "" : ` — ${matchCount} ${matchCount === 1 ? "match" : "matches"}`;
    const marked = highlightCount === 0 ? "" : ` — ${highlightCount} ${highlightCount === 1 ? "highlight" : "highlights"}`;
    return (
      <li
        {...common}
        className={`${styles.entry} ${selected ? styles.entrySelected : ""} ${status !== null && isRetired(status) ? styles.entryRetired : ""}`}
        style={tree ? { paddingLeft: TREE_PADDING + row.level * INDENT + CHEVRON } : undefined}
        aria-selected={selected}
        aria-label={`${doc.title} — ${doc.location}${described}${readState === "read" ? "" : ` — ${readState}`}${change === null ? "" : ` — ${changeSentence(change).toLowerCase()}`}${bookmarked ? " — bookmarked" : ""}${matches}${marked}`}
        onContextMenu={(e) => {
          // Desktop: a native menu (Mark as Read, Open in Editor, Reveal in
          // Finder…); the browser keeps its own
          const api = window.markdownApi;
          if (!api) return;
          e.preventDefault();
          void api.showDocumentMenu(doc.id, readState !== "read").then((choice) => {
            if (choice === "read") onMarkRead?.(doc.id);
            if (choice === "unread") onMarkUnread?.(doc.id);
          });
        }}
      >
        {status === null ? (
          <MarkdownIcon className={styles.entryIcon} />
        ) : (
          <StatusIcon status={status} className={styles.statusIcon} />
        )}
        {prefix !== null && <span className={styles.entryPrefix}>{prefix}</span>}
        <span className={styles.entryTitle}>{title}</span>
        {readState !== "read" && (
          <span
            className={`${styles.unreadDot} ${readState === "new" ? styles.unreadNew : ""}`}
            title={readState === "new" ? "New" : "Changed since you read it"}
            aria-hidden="true"
          />
        )}
        {change !== null && (
          <span
            className={`${styles.changeLetter} ${change.status === "A" ? styles.changeAdded : ""} ${change.uncommitted ? styles.changeUncommitted : ""}`}
            title={changeSentence(change)}
            aria-hidden="true"
          >
            {change.status}
          </span>
        )}
        {matchCount !== null && <span className={styles.matchCount}>{matchCount}</span>}
        {bookmarked && (
          <svg className={styles.bookmarked} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2h8v12l-4-3-4 3z" fill="currentColor" />
          </svg>
        )}
        {matchCount === null && highlightCount > 0 && (
          <span className={styles.marksCount} aria-hidden="true">
            <span className={styles.marksDot} />
            {highlightCount}
          </span>
        )}
      </li>
    );
  }

  if (row.kind === "heading") {
    const { heading } = row;
    const at = heading.text.toLowerCase().indexOf(query.toLowerCase());
    return (
      <li {...common} className={styles.matchEntry} aria-selected={false} aria-label={`Heading: ${heading.text}`} title={heading.text}>
        <span className={styles.headingMarker} aria-hidden="true">
          {"#".repeat(heading.level)}
        </span>
        {at < 0 ? (
          heading.text
        ) : (
          <>
            {heading.text.slice(0, at)}
            <mark className={styles.matchText}>{heading.text.slice(at, at + query.length)}</mark>
            {heading.text.slice(at + query.length)}
          </>
        )}
      </li>
    );
  }

  // The sidebar is narrow: keep only a little text before the match so the
  // match itself isn't cut off at the row's end
  const { match } = row;
  const lead =
    match.start > LEAD_CHARS + 1 ? "…" + match.text.slice(match.start - LEAD_CHARS, match.start) : match.text.slice(0, match.start);
  return (
    <li {...common} className={styles.matchEntry} aria-selected={false} aria-label={`Line ${match.line}: ${match.text}`} title={`Line ${match.line}`}>
      {lead}
      <mark className={styles.matchText}>{match.text.slice(match.start, match.end)}</mark>
      {match.text.slice(match.end)}
    </li>
  );
}

const LEAD_CHARS = 12;
const NO_COUNTS: ReadonlyMap<string, number> = new Map();
const NO_NOTES: ReadonlyMap<string, DocumentNote> = new Map();
const NO_READS: ReadonlyMap<string, DocumentRead> = new Map();
const NO_OPTIONS: { statuses: FilterOption[]; tags: FilterOption[] } = { statuses: [], tags: [] };
const NO_IDS: ReadonlySet<string> = new Set();
const NO_COMMITS: ReadonlyMap<string, GitLastCommit | null> = new Map();
