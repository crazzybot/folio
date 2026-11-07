/**
 * marksView.ts — The rows of the sidebar's Marks view: every listed
 * document that has marks, each followed by its heading bookmarks (named by
 * the heading, in document order) and then its highlights and notes (in
 * text order), narrowed by the filter box and "Notes only". A bookmark on
 * the document itself is shown on its row. (The open document's marks also
 * show in its outline.)
 */

import { findBookmark, headingIndex } from "./bookmarks";
import type { DocMarks } from "./useMarks";
import type { Bookmark, BookmarkHeading, DocumentMeta, Highlight } from "./types";

export type MarkRow =
  | {
      kind: "document";
      key: string;
      doc: DocumentMeta;
      /** The document is bookmarked as a whole. */
      bookmark: Bookmark | undefined;
      /** Heading bookmarks and highlights listed under it. */
      count: number;
      expanded: boolean;
    }
  | {
      kind: "bookmark";
      key: string;
      doc: DocumentMeta;
      bookmark: Bookmark & { heading: BookmarkHeading };
      /** The document no longer has this heading. */
      missing: boolean;
    }
  | {
      kind: "highlight";
      key: string;
      doc: DocumentMeta;
      highlight: Highlight;
      /** Not found in the open document's current text. */
      unplaced: boolean;
    };

export interface MarkRowsInput {
  /** The listed documents (the focused folder's, if any), in list order. */
  documents: readonly DocumentMeta[];
  byDoc: ReadonlyMap<string, DocMarks>;
  query: string;
  notesOnly: boolean;
  /** Documents whose marks are folded away. */
  collapsed: ReadonlySet<string>;
  /** The open document's highlights found in its text; the others are shown as not found. */
  located: { docId: string; ids: ReadonlySet<string> } | null;
}

const includes = (text: string | null | undefined, q: string) => text != null && text.toLowerCase().includes(q);

export function buildMarkRows(input: MarkRowsInput): MarkRow[] {
  const { documents, byDoc, notesOnly, collapsed, located } = input;
  const q = input.query.trim().toLowerCase();
  const rows: MarkRow[] = [];

  for (const doc of documents) {
    const marks = byDoc.get(doc.id);
    if (marks === undefined) continue;
    // No filter, or a matching title: all of the document's marks
    const titleMatch = q === "" || includes(doc.title, q) || includes(doc.filename, q);
    const docBookmark = notesOnly ? undefined : findBookmark(marks.bookmarks, null);

    const bookmarks = notesOnly
      ? []
      : marks.bookmarks
          .flatMap((b) => (b.heading === null ? [] : [{ ...b, heading: b.heading }]))
          .filter((b) => titleMatch || includes(b.heading.text, q))
          .map((bookmark) => ({ bookmark, index: headingIndex(doc.headings, bookmark.heading) }))
          // Document order; headings that are gone last
          .sort((a, b) => (a.index === -1 ? Infinity : a.index) - (b.index === -1 ? Infinity : b.index));

    const highlights = marks.highlights
      .filter((h) => !notesOnly || h.note !== null)
      .filter((h) => titleMatch || includes(h.quote.exact, q) || includes(h.note, q))
      .sort((a, b) => a.position.start - b.position.start);

    const count = bookmarks.length + highlights.length;
    // Listed when something under it matches, or for its own bookmark
    if (count === 0 && !(docBookmark !== undefined && titleMatch)) continue;
    // While filtering, every match shows
    const expanded = count > 0 && (q !== "" || !collapsed.has(doc.id));
    rows.push({ kind: "document", key: `d:${doc.id}`, doc, bookmark: docBookmark, count, expanded });
    if (!expanded) continue;

    for (const { bookmark, index } of bookmarks) {
      rows.push({ kind: "bookmark", key: `b:${doc.id}:${bookmark.id}`, doc, bookmark, missing: index === -1 });
    }
    for (const highlight of highlights) {
      rows.push({
        kind: "highlight",
        key: `h:${doc.id}:${highlight.id}`,
        doc,
        highlight,
        unplaced: located !== null && located.docId === doc.id && !located.ids.has(highlight.id),
      });
    }
  }
  return rows;
}
