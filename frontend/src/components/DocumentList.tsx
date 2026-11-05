import React, { useEffect, useId, useMemo, useState } from "react";
import { searchDocuments } from "../api";
import type { DocumentMeta, SearchMatch, SearchResult } from "../types";
import MarkdownIcon from "./MarkdownIcon";
import styles from "./DocumentList.module.css";

// Searching document text starts at this many characters, after a pause in typing
const MIN_CONTENT_QUERY = 2;
const CONTENT_SEARCH_DELAY_MS = 200;

interface DocumentListProps {
  documents: DocumentMeta[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  /** Open a document; `occurrence` is the search match to scroll to, if any. */
  onSelect: (id: string, occurrence?: number) => void;
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
  onSearchQueryChange,
}: DocumentListProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [contentSearch, setContentSearch] = useState<ContentSearch>({ status: "idle" });
  const searchId = useId();
  const trimmed = query.trim();

  // Search document text once typing pauses. Also re-runs when the document
  // list changes (live reload), so results follow edits.
  useEffect(() => {
    if (trimmed.length < MIN_CONTENT_QUERY) {
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
  }, [trimmed, documents, onSearchQueryChange]);

  const contentResults = contentSearch.status === "done" ? contentSearch.results : null;

  // Title / filename matches show instantly; text matches join once the search returns
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.filename.toLowerCase().includes(q) ||
        contentResults?.has(doc.id) === true,
    );
  }, [documents, trimmed, contentResults]);

  // Opening a document from a text search scrolls to its first match
  const open = (id: string, occurrence?: number) => {
    onSelect(id, occurrence ?? (contentResults?.has(id) ? 0 : undefined));
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
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter opens the first result
              const first = filtered[0];
              if (e.key === "Enter" && first !== undefined) {
                e.preventDefault();
                open(first.id);
              }
            }}
            aria-label="Search document titles and text"
            aria-describedby={`${searchId}-status`}
          />
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
          {contentSearch.status === "searching" && "Searching…"}
          {contentSearch.status === "error" && "Couldn't search document text"}
          {contentSearch.status === "done" &&
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

        {!loading && error === null && filtered.length === 0 && contentSearch.status !== "searching" && (
          <div className={styles.emptyArea}>
            {query ? (
              <p>No documents match "<strong>{query}</strong>".</p>
            ) : (
              <p>No documents found.</p>
            )}
          </div>
        )}

        {!loading && error === null && filtered.length > 0 && (
          <ul className={styles.list} role="listbox" aria-label="Document list">
            {filtered.map((doc) => {
              const result = contentResults?.get(doc.id);
              return (
                <React.Fragment key={doc.id}>
                  <DocumentEntry
                    doc={doc}
                    isSelected={doc.id === selectedId}
                    matchCount={result?.matchCount ?? null}
                    onOpen={() => open(doc.id)}
                  />
                  {result?.matches.map((match) => (
                    <MatchEntry
                      key={match.occurrence}
                      match={match}
                      onOpen={() => open(doc.id, match.occurrence)}
                    />
                  ))}
                  {result !== undefined && result.matchCount > result.matches.length && (
                    <li className={styles.moreMatches} aria-hidden="true">
                      {result.matchCount - result.matches.length} more in this document
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
