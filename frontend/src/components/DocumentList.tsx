import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchDocuments } from "../api";
import { slugify } from "../slug";
import type { DocumentMeta, Heading, SearchMatch, SearchResult } from "../types";
import MarkdownIcon from "./MarkdownIcon";
import styles from "./DocumentList.module.css";

// Searching document text starts at this many characters, after a pause in typing
const MIN_CONTENT_QUERY = 2;
const CONTENT_SEARCH_DELAY_MS = 200;
// Matching headings listed under a document before "N more"
const MAX_HEADING_ROWS = 3;

const FULL_TEXT_KEY = "folio.searchDocumentText";
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const FULL_TEXT_SHORTCUT = IS_MAC ? "⇧⌘F" : "Ctrl+Shift+F";

function loadFullText(): boolean {
  try {
    return localStorage.getItem(FULL_TEXT_KEY) === "true";
  } catch {
    return false;
  }
}

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
}

type ContentSearch =
  | { status: "idle" }
  | { status: "searching"; query: string }
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
}: DocumentListProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [fullText, setFullText] = useState(loadFullText);
  const [contentSearch, setContentSearch] = useState<ContentSearch>({ status: "idle" });
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  const chooseFullText = useCallback((on: boolean) => {
    setFullText(on);
    try {
      localStorage.setItem(FULL_TEXT_KEY, String(on));
    } catch {
      // Not remembered, but still applied
    }
  }, []);

  // ⇧⌘F / Ctrl+Shift+F: search document text, as in VS Code
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        chooseFullText(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseFullText]);

  // Search document text once typing pauses. Also re-runs when the document
  // list changes (live reload), so results follow edits.
  useEffect(() => {
    if (!fullText || trimmed.length < MIN_CONTENT_QUERY) {
      setContentSearch({ status: "idle" });
      onSearchQueryChange?.("");
      return;
    }
    let cancelled = false;
    setContentSearch((prev) =>
      prev.status === "done" && prev.query === trimmed ? prev : { status: "searching", query: trimmed },
    );
    const timer = setTimeout(() => {
      searchDocuments(trimmed)
        .then((results) => {
          if (cancelled) return;
          setContentSearch({ status: "done", query: trimmed, results: new Map(results.map((r) => [r.id, r])) });
          onSearchQueryChange?.(trimmed);
        })
        .catch(() => {
          if (!cancelled) setContentSearch({ status: "error", query: trimmed });
        });
    }, CONTENT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fullText, trimmed, documents, onSearchQueryChange]);

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

  const totalMatches = contentResults
    ? [...contentResults.values()].reduce((sum, r) => sum + r.matchCount, 0)
    : 0;

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <h1 className={styles.heading}>Documents</h1>
      </header>

      {/* ── Search ── */}
      <div className={styles.searchWrapper}>
        <label htmlFor={searchId} className={styles.srOnly}>
          Search documents
        </label>
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
            placeholder={fullText ? "Search document text…" : "Search titles and headings…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter opens the first result
              const first = results[0];
              if (e.key === "Enter" && first !== undefined) {
                e.preventDefault();
                openEntry(first);
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
        <p id={`${searchId}-status`} className={styles.searchStatus} aria-live="polite">
          {fullText && contentSearch.status === "searching" && "Searching…"}
          {fullText && contentSearch.status === "error" && "Couldn't search document text"}
          {contentResults !== null &&
            (totalMatches === 0
              ? "No matches in document text"
              : `${totalMatches} ${totalMatches === 1 ? "match" : "matches"} in ${contentResults?.size} ${
                  contentResults?.size === 1 ? "document" : "documents"
                }`)}
        </p>
      </div>

      {/* ── List body ── */}
      <div className={styles.listBody} role="region" aria-label="Document entries">
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

        {!loading && error === null && results.length === 0 && !(fullText && contentSearch.status === "searching") && (
          <div className={styles.emptyArea}>
            {!query ? (
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

        {!loading && error === null && results.length > 0 && (
          <ul className={styles.list} role="listbox" aria-label="Document list">
            {results.map((entry) => {
              const { doc, content } = entry;
              // Text matches already include heading lines, so they replace the heading rows
              const headings = content === undefined ? entry.headings : [];
              return (
                <React.Fragment key={doc.id}>
                  <DocumentEntry
                    doc={doc}
                    isSelected={doc.id === selectedId}
                    matchCount={content?.matchCount ?? null}
                    onOpen={() => openEntry(entry)}
                  />
                  {headings.slice(0, MAX_HEADING_ROWS).map((heading, i) => (
                    <HeadingEntry
                      key={i}
                      heading={heading}
                      query={trimmed}
                      onOpen={() => onOpenSection(doc.id, slugify(heading.text))}
                    />
                  ))}
                  {headings.length > MAX_HEADING_ROWS && (
                    <li className={styles.moreMatches} aria-hidden="true">
                      {headings.length - MAX_HEADING_ROWS} more headings
                    </li>
                  )}
                  {content?.matches.map((match) => (
                    <MatchEntry
                      key={match.occurrence}
                      match={match}
                      onOpen={() => onSelect(doc.id, match.occurrence)}
                    />
                  ))}
                  {content !== undefined && content.matchCount > content.matches.length && (
                    <li className={styles.moreMatches} aria-hidden="true">
                      {content.matchCount - content.matches.length} more in this document
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Entry sub-components ────────────────────────────────────────────────────

/** Enter / Space activate a list row, like a click. */
function activateOnKey(onOpen: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
}

interface DocumentEntryProps {
  doc: DocumentMeta;
  isSelected: boolean;
  /** Text matches in this document, or null when not searching its text. */
  matchCount: number | null;
  onOpen: () => void;
}

function DocumentEntry({ doc, isSelected, matchCount, onOpen }: DocumentEntryProps): React.ReactElement {
  // Like VS Code's quick-open description: the containing folder, dimmed
  const folder = doc.location.includes("/")
    ? doc.location.slice(0, doc.location.lastIndexOf("/"))
    : "";
  const matches = matchCount === null ? "" : ` — ${matchCount} ${matchCount === 1 ? "match" : "matches"}`;
  return (
    <li
      className={`${styles.entry} ${isSelected ? styles.entrySelected : ""}`}
      role="option"
      aria-selected={isSelected}
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      tabIndex={0}
      aria-label={`${doc.title} — ${doc.location}${matches}`}
      title={doc.location}
    >
      <MarkdownIcon className={styles.entryIcon} />
      <span className={styles.entryTitle}>{doc.title}</span>
      {folder && <span className={styles.entryFolder}>{folder}</span>}
      {matchCount !== null && <span className={styles.matchCount}>{matchCount}</span>}
    </li>
  );
}

interface MatchEntryProps {
  match: SearchMatch;
  onOpen: () => void;
}

interface HeadingEntryProps {
  heading: Heading;
  query: string;
  onOpen: () => void;
}

/** A matching heading under its document; opens the document at that section. */
function HeadingEntry({ heading, query, onOpen }: HeadingEntryProps): React.ReactElement {
  const at = heading.text.toLowerCase().indexOf(query.toLowerCase());
  return (
    <li
      className={styles.matchEntry}
      role="option"
      aria-selected={false}
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      tabIndex={0}
      aria-label={`Heading: ${heading.text}`}
      title={heading.text}
    >
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
const LEAD_CHARS = 12;

/** One matching line under its document, the match emphasised. */
function MatchEntry({ match, onOpen }: MatchEntryProps): React.ReactElement {
  const lead =
    match.start > LEAD_CHARS + 1 ? "…" + match.text.slice(match.start - LEAD_CHARS, match.start) : match.text.slice(0, match.start);
  return (
    <li
      className={styles.matchEntry}
      role="option"
      aria-selected={false}
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      tabIndex={0}
      aria-label={`Line ${match.line}: ${match.text}`}
      title={`Line ${match.line}`}
    >
      {lead}
      <mark className={styles.matchText}>{match.text.slice(match.start, match.end)}</mark>
      {match.text.slice(match.end)}
    </li>
  );
}
