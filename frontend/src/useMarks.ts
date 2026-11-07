/**
 * useMarks.ts — The workspace's bookmarks and highlights, by document id,
 * and the changes the viewer and the Marks view make to them.
 *
 * Reloaded when the workspace changes and when marks change in another
 * window (desktop), or when the window regains focus (browser — the
 * desktop app or another tab may have changed them).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addBookmark,
  addHighlight,
  deleteBookmark,
  deleteHighlight,
  fetchMarks,
  forgetMarks,
  relinkMarks,
  updateHighlight,
} from "./api";
import { findBookmark } from "./bookmarks";
import type { Bookmark, BookmarkHeading, Highlight, HighlightColor, MissingMarks, TextAnchor } from "./types";

// How long a failed change is reported in the status bar
const ERROR_SHOWN_MS = 6000;

/** One document's marks. */
export interface DocMarks {
  bookmarks: readonly Bookmark[];
  highlights: readonly Highlight[];
}

export interface Marks {
  /** Marks by document id; documents without any are absent. */
  byDoc: ReadonlyMap<string, DocMarks>;
  /** Highlight a passage; resolves to the saved highlight, or null if it couldn't be saved. */
  add(docId: string, anchor: TextAnchor, color: HighlightColor, note?: string | null): Promise<Highlight | null>;
  recolor(docId: string, highlightId: string, color: HighlightColor): Promise<void>;
  /** Set or (with null / blank) remove a highlight's note. */
  setNote(docId: string, highlightId: string, note: string | null): Promise<void>;
  remove(docId: string, highlightId: string): Promise<void>;
  /** Bookmark the document (`heading` null) or a heading, or remove that bookmark. */
  toggleBookmark(docId: string, heading: BookmarkHeading | null): Promise<void>;
  /** Remove a bookmark by id (e.g. one whose heading is gone). */
  removeBookmark(docId: string, bookmarkId: string): Promise<void>;
  /** Marks of files in the workspace that no longer exist. */
  missing: readonly MissingMarks[];
  /** Move a missing document's marks to `docId`. */
  relink(recordId: string, docId: string): Promise<void>;
  /** Delete a missing document's marks. */
  forget(recordId: string): Promise<void>;
  /** The last change that failed, briefly; null otherwise. */
  error: string | null;
}

const NO_MARKS: DocMarks = { bookmarks: [], highlights: [] };

export default function useMarks(): Marks {
  const [byDoc, setByDoc] = useState<ReadonlyMap<string, DocMarks>>(new Map());
  const [missing, setMissing] = useState<readonly MissingMarks[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Only the latest load may update state; an older one can finish late
  const generation = useRef(0);
  const reload = useCallback(() => {
    const current = ++generation.current;
    return fetchMarks()
      .then((listing) => {
        if (current !== generation.current) return;
        setByDoc(new Map(listing.documents.map((doc) => [doc.docId, { bookmarks: doc.bookmarks, highlights: doc.highlights }])));
        setMissing(listing.missing);
      })
      .catch(() => {
        // Keep what's shown; the next change or focus retries
      });
  }, []);

  useEffect(() => {
    const load = () => void reload();
    load();
    const api = window.markdownApi;
    let unsubscribe: () => void;
    if (api) {
      const fromWorkspace = api.onWorkspaceChange(load);
      const fromMarks = api.marks.onChange(load);
      unsubscribe = () => {
        fromWorkspace();
        fromMarks();
      };
    } else {
      window.addEventListener("focus", load);
      unsubscribe = () => window.removeEventListener("focus", load);
    }
    return unsubscribe;
  }, [reload]);

  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  /** Apply `change` to one document's marks. */
  const update = useCallback((docId: string, change: (marks: DocMarks) => DocMarks) => {
    setByDoc((prev) => {
      const next = new Map(prev);
      const marks = change(prev.get(docId) ?? NO_MARKS);
      if (marks.highlights.length === 0 && marks.bookmarks.length === 0) next.delete(docId);
      else next.set(docId, marks);
      return next;
    });
  }, []);

  const failed = useCallback((what: string) => (err: unknown) => {
    console.error(`Couldn't ${what}`, err);
    setError(`Couldn't ${what}`);
  }, []);

  /** Replace a saved highlight in its document's list. */
  const saved = useCallback(
    (docId: string) => (highlight: Highlight) =>
      update(docId, (m) => ({ ...m, highlights: m.highlights.map((h) => (h.id === highlight.id ? highlight : h)) })),
    [update],
  );

  const add = useCallback(
    (docId: string, anchor: TextAnchor, color: HighlightColor, note: string | null = null) =>
      addHighlight(docId, anchor, color, note).then(
        (highlight) => {
          update(docId, (m) => ({ ...m, highlights: [...m.highlights.filter((h) => h.id !== highlight.id), highlight] }));
          return highlight;
        },
        (err: unknown) => {
          failed("save the highlight")(err);
          return null;
        },
      ),
    [update, failed],
  );

  const recolor = useCallback(
    (docId: string, highlightId: string, color: HighlightColor) =>
      updateHighlight(docId, highlightId, { color }).then(saved(docId), failed("change the highlight")),
    [saved, failed],
  );

  const setNote = useCallback(
    (docId: string, highlightId: string, note: string | null) =>
      updateHighlight(docId, highlightId, { note: note?.trim() ? note : null }).then(saved(docId), failed("save the note")),
    [saved, failed],
  );

  const remove = useCallback(
    (docId: string, highlightId: string) =>
      deleteHighlight(docId, highlightId).then(
        () => update(docId, (m) => ({ ...m, highlights: m.highlights.filter((h) => h.id !== highlightId) })),
        failed("remove the highlight"),
      ),
    [update, failed],
  );

  const removeBookmark = useCallback(
    (docId: string, bookmarkId: string) =>
      deleteBookmark(docId, bookmarkId).then(
        () => update(docId, (m) => ({ ...m, bookmarks: m.bookmarks.filter((b) => b.id !== bookmarkId) })),
        failed("remove the bookmark"),
      ),
    [update, failed],
  );

  const toggleBookmark = useCallback(
    (docId: string, heading: BookmarkHeading | null) => {
      const existing = findBookmark(byDoc.get(docId)?.bookmarks ?? [], heading);
      if (existing !== undefined) return removeBookmark(docId, existing.id);
      return addBookmark(docId, heading).then(
        (bookmark) =>
          update(docId, (m) => ({ ...m, bookmarks: [...m.bookmarks.filter((b) => b.id !== bookmark.id), bookmark] })),
        failed("save the bookmark"),
      );
    },
    [byDoc, update, removeBookmark, failed],
  );

  // Moving or deleting a missing document's marks changes the whole listing: reload it
  const relink = useCallback(
    (recordId: string, docId: string) => relinkMarks(recordId, docId).then(reload, failed("move the marks")),
    [reload, failed],
  );
  const forget = useCallback(
    (recordId: string) => forgetMarks(recordId).then(reload, failed("delete the marks")),
    [reload, failed],
  );

  return { byDoc, add, recolor, setNote, remove, toggleBookmark, removeBookmark, missing, relink, forget, error };
}
