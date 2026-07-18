import React, { useId, useMemo, useState } from "react";
import type { DocumentMeta } from "../types";
import styles from "./DocumentList.module.css";

interface DocumentListProps {
  documents: DocumentMeta[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

export default function DocumentList({
  documents,
  selectedId,
  loading,
  error,
  onSelect,
}: DocumentListProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.filename.toLowerCase().includes(q),
    );
  }, [documents, query]);

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
            aria-label="Search documents by title or filename"
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

        {!loading && error === null && filtered.length === 0 && (
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
            {filtered.map((doc) => (
              <DocumentEntry
                key={doc.id}
                doc={doc}
                isSelected={doc.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer count ── */}
      {!loading && documents.length > 0 && (
        <footer className={styles.footer} aria-live="polite">
          {filtered.length === documents.length
            ? `${documents.length} document${documents.length !== 1 ? "s" : ""}`
            : `${filtered.length} of ${documents.length}`}
        </footer>
      )}
    </div>
  );
}

// ─── Entry sub-component ─────────────────────────────────────────────────────

interface DocumentEntryProps {
  doc: DocumentMeta;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function DocumentEntry({
  doc,
  isSelected,
  onSelect,
}: DocumentEntryProps): React.ReactElement {
  return (
    <li
      className={`${styles.entry} ${isSelected ? styles.entrySelected : ""}`}
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(doc.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(doc.id);
        }
      }}
      tabIndex={0}
      aria-label={`${doc.title} — ${doc.location}`}
    >
      <span className={styles.entryTitle}>{doc.title}</span>
      <span className={styles.entryLocation} title={doc.location}>
        {doc.location}
      </span>
    </li>
  );
}
