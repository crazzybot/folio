/**
 * useMarks.ts — The workspace's highlights, by document id, and the
 * changes the viewer makes to them.
 *
 * Reloaded when the workspace changes and when marks change in another
 * window (desktop), or when the window regains focus (browser — the
 * desktop app or another tab may have changed them).
 */

import { useCallback, useEffect, useState } from "react";
import { addHighlight, deleteHighlight, fetchMarks, updateHighlight } from "./api";
import type { Highlight, HighlightColor, TextAnchor } from "./types";

// How long a failed change is reported in the status bar
const ERROR_SHOWN_MS = 6000;

export interface Marks {
  /** Highlights by document id; documents without any are absent. */
  highlights: ReadonlyMap<string, readonly Highlight[]>;
  add(docId: string, anchor: TextAnchor, color: HighlightColor): Promise<void>;
  recolor(docId: string, highlightId: string, color: HighlightColor): Promise<void>;
  remove(docId: string, highlightId: string): Promise<void>;
  /** The last change that failed, briefly; null otherwise. */
  error: string | null;
}

export default function useMarks(): Marks {
  const [highlights, setHighlights] = useState<ReadonlyMap<string, readonly Highlight[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only the latest load may update state; an older one can finish late
    let generation = 0;
    const load = () => {
      const current = ++generation;
      fetchMarks()
        .then((listing) => {
          if (cancelled || current !== generation) return;
          setHighlights(new Map(listing.documents.map((doc) => [doc.docId, doc.highlights])));
        })
        .catch(() => {
          // Keep what's shown; the next change or focus retries
        });
    };
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
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  /** Apply `change` to one document's list. */
  const update = useCallback((docId: string, change: (list: readonly Highlight[]) => readonly Highlight[]) => {
    setHighlights((prev) => {
      const next = new Map(prev);
      const list = change(prev.get(docId) ?? []);
      if (list.length === 0) next.delete(docId);
      else next.set(docId, list);
      return next;
    });
  }, []);

  const failed = useCallback((what: string) => (err: unknown) => {
    console.error(`Couldn't ${what}`, err);
    setError(`Couldn't ${what}`);
  }, []);

  const add = useCallback(
    (docId: string, anchor: TextAnchor, color: HighlightColor) =>
      addHighlight(docId, anchor, color).then(
        (saved) => update(docId, (list) => [...list.filter((h) => h.id !== saved.id), saved]),
        failed("save the highlight"),
      ),
    [update, failed],
  );

  const recolor = useCallback(
    (docId: string, highlightId: string, color: HighlightColor) =>
      updateHighlight(docId, highlightId, { color }).then(
        (saved) => update(docId, (list) => list.map((h) => (h.id === saved.id ? saved : h))),
        failed("change the highlight"),
      ),
    [update, failed],
  );

  const remove = useCallback(
    (docId: string, highlightId: string) =>
      deleteHighlight(docId, highlightId).then(
        () => update(docId, (list) => list.filter((h) => h.id !== highlightId)),
        failed("remove the highlight"),
      ),
    [update, failed],
  );

  return { highlights, add, recolor, remove, error };
}
