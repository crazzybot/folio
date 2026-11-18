/**
 * useShownDocument.ts — The content of the document in the URL: fetched
 * when it changes, and refreshed in place when the workspace changes
 * (desktop live reload): no loading state then, so the scroll position stays.
 */

import { useEffect, useRef, useState } from "react";
import { fetchDocumentContent } from "./api";

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; id: string; content: string; sha1: string | null }
  | { status: "error"; message: string };

/** The latest fetch result for a document. */
type LoadedContent = { id: string } & (
  | { status: "success"; content: string; sha1: string | null }
  | { status: "error"; message: string }
);

export function useShownDocument(selectedId: string | null): LoadState {
  // Only the latest result is stored; whether it's the shown document's (else
  // that one is still loading) is worked out here, during render.
  const [loaded, setLoaded] = useState<LoadedContent | null>(null);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    fetchDocumentContent(selectedId)
      .then((doc) => {
        if (cancelled) return;
        setLoaded({ status: "success", id: selectedId, content: doc.content, sha1: doc.sha1 ?? null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          status: "error",
          id: selectedId,
          message: err instanceof Error ? err.message : "Failed to load content",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    // Only the latest refresh may update state; older ones finish late
    let generation = 0;
    const unsubscribe = api.onWorkspaceChange(() => {
      const current = ++generation;
      const id = selectedIdRef.current;
      if (id === null) return;
      fetchDocumentContent(id)
        .then((doc) => {
          if (current !== generation || selectedIdRef.current !== id) return;
          setLoaded((prev) =>
            prev !== null && prev.status === "success" && prev.id === id && prev.sha1 === (doc.sha1 ?? null) && prev.content === doc.content
              ? prev
              : { status: "success", id, content: doc.content, sha1: doc.sha1 ?? null },
          );
        })
        .catch(() => {
          if (current !== generation || selectedIdRef.current !== id) return;
          setLoaded({ status: "error", id, message: "This document was moved or deleted." });
        });
    });
    return () => {
      generation++;
      unsubscribe();
    };
  }, []);

  if (selectedId === null) return { status: "idle" };
  if (loaded === null || loaded.id !== selectedId) return { status: "loading" };
  return loaded;
}
