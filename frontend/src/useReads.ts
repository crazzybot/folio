/**
 * useReads.ts — The read records of the workspace's documents (reads.ts),
 * kept up to date, and marking the open document read: once it has been
 * shown for READ_AFTER_MS with the window focused. Mark as read and Mark as
 * unread do it by hand.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchReads, markFolderRead, markRead, markUnread } from "./api";
import { readStateOf } from "./reads";
import type { DocumentRead } from "./types";

export const READ_AFTER_MS = 3_000;

export interface Reads {
  /** By document id. */
  byDoc: ReadonlyMap<string, DocumentRead>;
  /** Documents that are new or changed. */
  unreadIds: ReadonlySet<string>;
  /** Record that the version with `sha1` was read (the version shown). */
  markRead: (docId: string, sha1: string) => void;
  markUnread: (docId: string) => void;
  /** Every document under `folder` ("" for all). */
  markFolderRead: (folder: string) => void;
}

export function useReads(): Reads {
  const [list, setList] = useState<readonly DocumentRead[]>([]);
  // Only the latest load may update state; an older one can finish late
  const generation = useRef(0);
  const reload = useCallback(() => {
    const current = ++generation.current;
    fetchReads()
      .then((next) => {
        if (current === generation.current) setList(next);
      })
      .catch(() => {
        // Keep what's shown; the next change or focus retries
      });
  }, []);

  useEffect(() => {
    reload();
    const api = window.markdownApi;
    if (api) {
      const fromWorkspace = api.onWorkspaceChange(reload);
      const fromReads = api.reads.onChange(reload);
      return () => {
        fromWorkspace();
        fromReads();
      };
    }
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const byDoc = useMemo(() => new Map(list.map((entry) => [entry.docId, entry])), [list]);
  const unreadIds = useMemo(
    () => new Set(list.filter((entry) => readStateOf(entry) !== "read").map((entry) => entry.docId)),
    [list],
  );

  // The desktop app tells every window when records change; the demo has
  // no such event, so it reloads after its own changes
  const after = useCallback(
    (change: Promise<void>) =>
      void change.then(
        () => {
          if (!window.markdownApi) reload();
        },
        () => reload(),
      ),
    [reload],
  );

  return {
    byDoc,
    unreadIds,
    markRead: useCallback((docId: string, sha1: string) => after(markRead(docId, sha1)), [after]),
    markUnread: useCallback((docId: string) => after(markUnread(docId)), [after]),
    markFolderRead: useCallback((folder: string) => after(markFolderRead(folder)), [after]),
  };
}

/**
 * Mark the shown document read once it has been on screen for READ_AFTER_MS
 * with the window focused. `sha1` is the version shown; nothing happens
 * while it's null (loading) or the document is already read.
 */
export function useMarkReadWhenShown(docId: string | null, sha1: string | null, unread: boolean, markRead: (docId: string, sha1: string) => void): void {
  useEffect(() => {
    if (docId === null || sha1 === null || !unread) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      clearTimeout(timer);
      if (document.hasFocus() && document.visibilityState === "visible") {
        timer = setTimeout(() => markRead(docId, sha1), READ_AFTER_MS);
      }
    };
    const stop = () => clearTimeout(timer);
    start();
    window.addEventListener("focus", start);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      window.removeEventListener("focus", start);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", start);
    };
  }, [docId, sha1, unread, markRead]);
}
