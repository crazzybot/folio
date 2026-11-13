/**
 * demo/source.ts — The live demo's data source: the whole workspace comes
 * from a bundle made at build time (desktop/scripts/demo-bundle.mjs), search
 * runs in the page and marks are kept in the browser. No server.
 *
 * Next to the app, the build publishes:
 *   bundle.json     the documents, their Markdown, attachments and seed marks
 *   workspace/…     the demo repository's files, for images and linked files
 */

import type { DataSource } from "../dataSource";
import type { DocumentContent, DocumentMeta } from "../types";
import { DemoMarks, type MarksStorage, type StoredMarks } from "./marks";
import { DemoReads, sha1Of } from "./reads";
import { searchDocuments } from "./search";

export interface DemoBundle {
  /** In document-list order, as a workspace scan returns them. */
  documents: DocumentMeta[];
  /** Markdown by document id. */
  contents: Record<string, string>;
  /** Workspace-relative paths of the image files. */
  attachments: string[];
  /** The marks a first visit starts with, by document id. */
  seedMarks: Record<string, StoredMarks>;
}

export interface DemoSource extends DataSource {
  /** Back to the seed marks. */
  resetMarks(): Promise<void>;
}

/** localStorage, or null where reading it throws (blocked storage). */
function browserStorage(): MarksStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @param base    where the bundle and workspace/ are, ending in "/"
 * @param storage where marks are kept; null keeps them in memory
 */
export function createDemoSource(base: string, storage: MarksStorage | null = browserStorage()): DemoSource {
  let loaded: Promise<{ bundle: DemoBundle; marks: DemoMarks; reads: DemoReads }> | null = null;

  // Fetched on first use; a failed fetch is retried on the next call
  function load(): Promise<{ bundle: DemoBundle; marks: DemoMarks; reads: DemoReads }> {
    loaded ??= fetch(`${base}bundle.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const bundle = (await res.json()) as DemoBundle;
        return {
          bundle,
          marks: new DemoMarks(bundle.documents, bundle.seedMarks, storage),
          reads: new DemoReads(bundle.documents, bundle.contents, storage),
        };
      })
      .catch((err: unknown) => {
        loaded = null;
        throw err;
      });
    return loaded;
  }

  const bundle = async () => (await load()).bundle;
  const marks = async () => (await load()).marks;
  const reads = async () => (await load()).reads;

  return {
    listDocuments: async () => structuredClone((await bundle()).documents),
    listAttachments: async () => [...(await bundle()).attachments],
    searchDocuments: async (query) => {
      const { documents, contents } = await bundle();
      return searchDocuments(documents, contents, query);
    },
    workspaceFileUrl: (encoded) => `${base}workspace/${encoded}`,
    getDocumentContent: async (id): Promise<DocumentContent> => {
      const content = (await bundle()).contents[id];
      if (content === undefined) throw new Error(`Document '${id}' not found`);
      return { id, content, sha1: await sha1Of(content) };
    },
    reads: {
      list: async () => (await reads()).list(),
      mark: async (docId, sha1) => (await reads()).mark(docId, sha1),
      unmark: async (docId) => (await reads()).unmark(docId),
      markFolder: async (folder) => (await reads()).markFolder(folder),
    },
    marks: {
      list: async () => (await marks()).list(),
      addHighlight: async (docId, body) => (await marks()).addHighlight(docId, body),
      updateHighlight: async (docId, highlightId, changes) =>
        (await marks()).updateHighlight(docId, highlightId, changes),
      deleteHighlight: async (docId, highlightId) => (await marks()).deleteHighlight(docId, highlightId),
      addBookmark: async (docId, heading) => (await marks()).addBookmark(docId, heading),
      deleteBookmark: async (docId, bookmarkId) => (await marks()).deleteBookmark(docId, bookmarkId),
      setNote: async (docId, note) => (await marks()).setNote(docId, note),
      deleteNote: async (docId) => (await marks()).deleteNote(docId),
      // The demo's documents never move or disappear, so no marks are ever missing
      relink: async () => undefined,
      forget: async () => undefined,
      send: async (docs, markSent) => (await marks()).send(docs, markSent),
      unsend: async (round) => (await marks()).unsend(round),
      reply: async (docId, highlightId, text) => (await marks()).reply(docId, highlightId, text),
      markSeen: async (docId, highlightId) => (await marks()).markSeen(docId, highlightId),
    },
    resetMarks: async () => (await marks()).reset(),
  };
}
