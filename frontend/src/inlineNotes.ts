/**
 * inlineNotes.ts — Notes shown in the text, under the passage they're about
 * (notes/inline-notes.md): after the smallest block holding the passage's
 * end, numbered like footnotes when a block has several, and in a row of
 * their own under a table row.
 *
 * Unlike highlights, this changes the DOM React rendered: note blocks are
 * inserted after blocks, and a marker after a passage splits its text node.
 * Everything inserted has `data-marks-skip`, so the text highlights anchor
 * to (textModel.ts) doesn't change. `placeInlineNotes` records each change
 * and its `remove` undoes it exactly, merging split text back, so the DOM is
 * React's again. Highlight ranges are live: they follow the splits and
 * merges (the DOM moves live ranges on `splitText`; `remove` moves them by
 * hand), so the highlights stay painted.
 *
 * React writes a text node's new text into the node it created, so a split
 * one would keep its old second half. `watchInlineNotes` removes the notes
 * on any change to the document's DOM that isn't theirs and places them
 * again: a MutationObserver runs before the browser paints, so the doubled
 * text is never shown.
 */

export interface InlineNote {
  id: string;
  /** The highlight's live range in the document. */
  range: Range;
  /** The highlight's colour, for the marker and the rule. */
  color: string;
  note: string;
}

/** Blocks a note goes after; where they nest, the innermost one holding the passage's end. */
const NOTE_BLOCKS = "p, h1, h2, h3, h4, h5, h6, pre, li, dt, dd, td, th";
/** Left out of the document's text, as textModel.ts reads it. */
const SKIP_ATTR = "data-marks-skip";

/** Where a group of notes goes. */
interface Spot {
  /** The element the notes follow: a block, a table row, or a table. */
  after: Element;
  kind: "block" | "item" | "row" | "table";
}

/** Where `range`'s notes go, or null where they can't be shown (a closed `<details>`). */
export function spotFor(range: Range): Spot | null {
  const end = range.endContainer;
  const start = end.nodeType === Node.ELEMENT_NODE ? (end as Element) : end.parentElement;
  const block = start?.closest(NOTE_BLOCKS) ?? null;
  if (block === null) return null;
  if (block.closest("details:not([open])") !== null) return null;
  if (block.tagName === "TD" || block.tagName === "TH") {
    const row = block.closest("tr");
    const table = block.closest("table");
    if (row === null || table === null) return null;
    // A row can't be inserted cleanly under cells that span rows
    return table.querySelector("[rowspan]") === null ? { after: row, kind: "row" } : { after: table, kind: "table" };
  }
  return { after: block, kind: block.tagName === "LI" ? "item" : "block" };
}

/** What `placeInlineNotes` changed, to undo. */
interface Split {
  /** The text node React made, holding the text before the marker. */
  head: Text;
  /** The text after the marker, split off. */
  tail: Text;
  /** The head's text once split: if it changes, React wrote new text into it. */
  headText: string;
}

export interface PlacedNotes {
  /** Undo every change; `ranges` are moved off split-off text first. */
  remove(ranges: readonly Range[]): void;
  /** The elements inserted, for the observer to tell them apart. */
  owns(node: Node): boolean;
}

/** Order two ranges by their ends. */
function byEnd(a: InlineNote, b: InlineNote): number {
  return a.range.compareBoundaryPoints(Range.END_TO_END, b.range);
}

function skipped<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.setAttribute(SKIP_ATTR, "");
  el.contentEditable = "false";
  el.className = className;
  return el;
}

/** A cell's text as shown: KaTeX math by its rendered text, not its MathML and TeX source as well. */
function shownText(cell: Element | undefined): string {
  if (cell === undefined) return "";
  const copy = cell.cloneNode(true) as Element;
  for (const math of copy.querySelectorAll(".katex")) math.replaceWith(math.querySelector(".katex-html")?.textContent ?? "");
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The label for a note on a table cell: its column's header, and its row's first cell when outside the row. */
function cellLabel(range: Range, withRow: boolean): string {
  const node = range.endContainer;
  const cell = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest("td, th");
  const row = cell?.closest("tr");
  const table = cell?.closest("table");
  if (cell == null || row == null || table == null) return "";
  const index = [...row.children].indexOf(cell);
  const header = shownText(table.querySelector("thead tr")?.children[index]);
  const rowName = shownText(row.children[0]);
  const parts = [withRow && rowName !== "" ? `Row ${rowName}` : "", header !== "" ? (withRow ? `column ${header}` : header) : ""];
  return parts.filter((p) => p !== "").join(", ");
}

/** Insert `marker` at `range`'s end; a split text node is recorded in `splits`. */
function insertAtEnd(range: Range, marker: Element, splits: Split[]): void {
  const node = range.endContainer;
  const offset = range.endOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (offset < text.length) {
      // Live ranges ending at `offset` stay in `text`; those after it move to the tail
      const tail = text.splitText(offset);
      splits.push({ head: text, tail, headText: text.data });
      tail.before(marker);
    } else {
      text.after(marker);
    }
    return;
  }
  node.insertBefore(marker, node.childNodes[offset] ?? null);
}

/**
 * Show `notes` in the document under `article`. Notes whose passage has no
 * place (a closed `<details>`) aren't shown; their margin icons stay.
 */
export function placeInlineNotes(article: HTMLElement, notes: readonly InlineNote[]): PlacedNotes {
  const inserted: Element[] = [];
  const splits: Split[] = [];

  // Grouped by where they go, each group in the order of the passages' ends
  const groups = new Map<Element, { spot: Spot; notes: InlineNote[] }>();
  for (const note of notes) {
    if (!article.contains(note.range.endContainer)) continue;
    const spot = spotFor(note.range);
    if (spot === null) continue;
    const group = groups.get(spot.after) ?? { spot, notes: [] };
    group.notes.push(note);
    groups.set(spot.after, group);
  }

  for (const { spot, notes: group } of groups.values()) {
    group.sort(byEnd);
    const numbered = group.length > 1 || spot.kind === "row" || spot.kind === "table";

    const list = skipped("div", "folio-inline-notes");
    group.forEach((note, i) => {
      const item = skipped("div", "folio-inline-note");
      item.dataset.highlight = note.id;
      item.style.setProperty("--note-color", note.color);
      if (numbered) {
        const number = String(i + 1);
        const marker = skipped("sup", "folio-note-marker");
        marker.dataset.highlight = note.id;
        marker.style.setProperty("--note-color", note.color);
        marker.textContent = number;
        insertAtEnd(note.range, marker, splits);
        inserted.push(marker);
        const label = skipped("span", "folio-inline-note-number");
        label.textContent = number;
        item.append(label);
      }
      const where = spot.kind === "row" ? cellLabel(note.range, false) : spot.kind === "table" ? cellLabel(note.range, true) : "";
      if (where !== "") {
        const label = skipped("em", "folio-inline-note-where");
        label.textContent = `${where}: `;
        item.append(label);
      }
      item.append(note.note);
      list.append(item);
    });

    if (spot.kind === "row") {
      const row = skipped("tr", "folio-inline-notes-row");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, ...[...(spot.after.closest("table")?.rows ?? [])].map((r) => r.cells.length));
      cell.append(list);
      row.append(cell);
      spot.after.after(row);
      inserted.push(row);
    } else if (spot.kind === "item") {
      // After the item's own text, before the lists nested in it
      const nested = spot.after.querySelector(":scope > ul, :scope > ol");
      spot.after.insertBefore(list, nested);
      inserted.push(list);
    } else {
      spot.after.after(list);
      inserted.push(list);
    }
  }

  return {
    remove(ranges) {
      for (const el of inserted) el.remove();
      // Latest splits first: a text node split twice is merged back from its end
      for (const { head, tail, headText } of [...splits].reverse()) {
        if (tail.parentNode === null) continue;
        const at = head.length;
        // React wrote new text into the head, or moved or removed it: the tail is stale
        const stale = head.data !== headText || head.nextSibling !== tail;
        if (!stale) {
          head.appendData(tail.data);
          for (const range of ranges) {
            if (range.startContainer === tail) range.setStart(head, at + range.startOffset);
            if (range.endContainer === tail) range.setEnd(head, at + range.endOffset);
          }
        }
        tail.remove();
      }
    },
    owns(node) {
      return inserted.some((el) => el === node || el.contains(node)) || splits.some((s) => s.tail === node);
    },
  };
}

/**
 * Keep `notes()` shown under `article`: placed now, and placed again after
 * any change to the document's DOM that isn't theirs (React re-rendering,
 * a diagram drawn). `ranges()` are the live highlight ranges to keep
 * whole. Returns a function that removes the notes and stops watching.
 */
export function watchInlineNotes(
  article: HTMLElement,
  notes: () => readonly InlineNote[],
  ranges: () => readonly Range[],
  onPlaced?: () => void,
): () => void {
  let placed: PlacedNotes | null = null;
  // The notes' own changes are made while not observing, so a record is
  // someone else's unless it's inside a note (content rendered into it later)
  const observer = new MutationObserver((records) => {
    if (records.some((r) => placed === null || !placed.owns(r.target))) place();
  });
  const watch = () => observer.observe(article, { subtree: true, childList: true, characterData: true });

  function place() {
    observer.disconnect();
    placed?.remove(ranges());
    placed = placeInlineNotes(article, notes());
    observer.takeRecords();
    watch();
    onPlaced?.();
  }

  place();
  return () => {
    observer.disconnect();
    placed?.remove(ranges());
    placed = null;
  };
}
