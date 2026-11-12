/**
 * inlineNotes.ts — Notes shown in the text, under the passage they're about
 * (docs/design/inline-notes.md): after the smallest block holding the passage's
 * end, numbered in the order of their passages when a block has several,
 * and in a row of their own under a table row. Hovering links a note to its
 * highlight (MarksLayer); nothing is put inside the text itself.
 *
 * Unlike highlights, this adds to the DOM React rendered, but only beside
 * its elements: React's elements and text nodes are never changed, and
 * React keeps its own nodes in place around extra siblings. Everything
 * inserted has `data-marks-skip`, so the text highlights anchor to
 * (textModel.ts) doesn't change, and `remove` takes it all out again.
 *
 * When React adds, removes or replaces elements, notes could be left beside
 * the wrong block: `watchInlineNotes` places them again on any such change
 * to the document that isn't theirs.
 */

import { NOTE_ICON_LABELS, noteIconMarkup } from "./noteIcons";
import type { NoteIconKind } from "./noteIcons";

export interface InlineNote {
  id: string;
  /** The highlight's live range in the document. */
  range: Range;
  /** The highlight's colour, for the rule beside the note. */
  color: string;
  note: string;
  /** Its place in the review loop, shown as the margin icon is (noteIcons.ts). */
  icon?: NoteIconKind;
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

export interface PlacedNotes {
  /** Take the notes out of the document. */
  remove(): void;
  /** Whether `node` is in the notes, for the observer to tell their changes apart. */
  owns(node: Node): boolean;
}

/** Order two ranges by their ends. */
function byEnd(a: InlineNote, b: InlineNote): number {
  return a.range.compareBoundaryPoints(Range.END_TO_END, b.range);
}

function skipped<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.setAttribute(SKIP_ATTR, "");
  el.setAttribute("contenteditable", "false");
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

/**
 * Show `notes` in the document under `article`. Notes whose passage has no
 * place (a closed `<details>`) aren't shown; their margin icons stay.
 */
export function placeInlineNotes(article: HTMLElement, notes: readonly InlineNote[]): PlacedNotes {
  const inserted: Element[] = [];

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
    const numbered = group.length > 1;

    const list = skipped("div", "folio-inline-notes");
    group.forEach((note, i) => {
      const item = skipped("div", "folio-inline-note");
      item.dataset.highlight = note.id;
      item.style.setProperty("--note-color", note.color);
      if (numbered) {
        const label = skipped("span", "folio-inline-note-number");
        label.textContent = String(i + 1);
        item.append(label);
      }
      if (note.icon !== undefined) {
        const icon = skipped("span", `folio-inline-note-icon folio-inline-note-${note.icon}`);
        icon.title = NOTE_ICON_LABELS[note.icon];
        icon.innerHTML = noteIconMarkup(note.icon);
        item.append(icon);
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

  // What's ours, to tell the observer's records apart by walking up from a node
  const own = new WeakSet<Node>(inserted);

  return {
    remove() {
      for (const el of inserted) el.remove();
    },
    owns(node) {
      for (let n: Node | null = node; n !== null && n !== article; n = n.parentNode) if (own.has(n)) return true;
      return false;
    },
  };
}

/**
 * Keep `notes()` shown under `article`: placed now, and placed again after
 * elements in the document are added or removed by anything but them (React
 * re-rendering, a diagram drawn). Returns a function that removes the notes
 * and stops watching.
 */
export function watchInlineNotes(
  article: HTMLElement,
  notes: () => readonly InlineNote[],
  onPlaced?: () => void,
): () => void {
  let placed: PlacedNotes | null = null;
  // The notes' own changes are made while not observing, so a record is
  // someone else's unless it's inside a note (content rendered into it later)
  const observer = new MutationObserver((records) => {
    if (records.some((r) => placed === null || !placed.owns(r.target))) place();
  });
  const watch = () => observer.observe(article, { subtree: true, childList: true });

  function place() {
    observer.disconnect();
    placed?.remove();
    placed = placeInlineNotes(article, notes());
    observer.takeRecords();
    watch();
    onPlaced?.();
  }

  place();
  return () => {
    observer.disconnect();
    placed?.remove();
    placed = null;
  };
}
