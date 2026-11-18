/**
 * useDocuments.ts — The workspace's documents: loaded once, and again when
 * the workspace changes (desktop live reload), keeping the last list if a
 * reload fails.
 */

import { useEffect, useRef, useState } from "react";
import { fetchDocuments } from "./api";
import type { DocumentMeta } from "./types";

export interface Documents {
  documents: DocumentMeta[];
  loading: boolean;
  /** The first load failed. */
  error: string | null;
}

/**
 * `onLoad` is called after each load with the new list; `first` is true for
 * the load on mount (where App picks the document to start on).
 */
export function useDocuments(onLoad: (docs: DocumentMeta[], first: boolean) => void): Documents {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The latest callback, so the effects below run once
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    let cancelled = false;
    fetchDocuments()
      .then((docs) => {
        if (cancelled) return;
        setDocuments(docs);
        setError(null);
        onLoadRef.current(docs, true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load documents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    // Only the latest reload may update state; older ones finish late
    let generation = 0;
    const unsubscribe = api.onWorkspaceChange(() => {
      const current = ++generation;
      fetchDocuments()
        .then((docs) => {
          if (current !== generation) return;
          setDocuments(docs);
          setError(null);
          onLoadRef.current(docs, false);
        })
        .catch(() => {
          // Keep showing the last list; the next change retries
        });
    });
    return () => {
      generation++;
      unsubscribe();
    };
  }, []);

  return { documents, loading, error };
}
