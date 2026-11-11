import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { describeSpan, locateAnchor } from "../anchoring";
import { findBookmark, headingIdentities, sameHeading } from "../bookmarks";
import { getItem, setItem } from "../storage";
import { watchInlineNotes } from "../inlineNotes";
import type { InlineNote } from "../inlineNotes";
import { buildTextModel } from "../textModel";
import { HIGHLIGHT_COLORS } from "../types";
import type { Bookmark, BookmarkHeading, Highlight, HighlightColor, TextAnchor } from "../types";
import styles from "./MarksLayer.module.css";

// The colour ⌘⇧H and Add note use: the last one picked
const COLOR_KEY = "folio.highlightColor";
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const HIGHLIGHT_SHORTCUT = IS_MAC ? "⇧⌘H" : "Ctrl+Shift+H";
const SAVE_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;
// Room above a selection for the toolbar; with less, it goes below
const TOOLBAR_ROOM = 44;
// Space kept between the toolbar or popover and the viewer's edges
const EDGE_GAP = 8;
// Heading bookmark icons sit this far left of the heading; note icons this
// far right of the text column
const HEADING_ICON_OFFSET = 26;
const NOTE_MARGIN = 6;
// A heading's row reaches this much further left than its button
const HEADING_ROW_SLACK = 8;
const HEADINGS = "h1, h2, h3, h4, h5, h6";
// The blocks a note can be added to from the margin; where they nest (a
// paragraph in a list item), the innermost one under the pointer
const BLOCKS = `${HEADINGS}, p, li, dt, dd, table, pre`;
// The margin the note button sits in counts as the block's row
const NOTE_BUTTON_ROOM = 26;
// Between a highlight and its popover
const POPOVER_GAP = 6;

const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };

function loadColor(): HighlightColor {
  const saved = getItem(COLOR_KEY);
  return HIGHLIGHT_COLORS.find((c) => c === saved) ?? "yellow";
}

/** Paint highlights by colour (::highlight(folio-mark-<colour>) in index.css), under search and find. */
function paint(byColor: ReadonlyMap<HighlightColor, Range[]>): void {
  if (!supported) return;
  for (const color of HIGHLIGHT_COLORS) {
    const ranges = byColor.get(color) ?? [];
    if (ranges.length === 0) {
      CSS.highlights.delete(`folio-mark-${color}`);
      continue;
    }
    const highlight = new Highlight(...ranges);
    highlight.priority = -1;
    CSS.highlights.set(`folio-mark-${color}`, highlight);
  }
}

/** Where to show something by `rect`, in the scroll container's content coordinates. */
interface Placement {
  top: number;
  left: number;
  /** Shown below `rect` rather than above it. */
  below: boolean;
  /** `rect`'s top and bottom, for the popover to go above it when there's no room below. */
  rectTop: number;
  rectBottom: number;
}

function placeBy(container: HTMLElement, rect: DOMRect, preferBelow: boolean): Placement {
  const box = container.getBoundingClientRect();
  const below = preferBelow || rect.top - box.top < TOOLBAR_ROOM;
  const center = rect.left + rect.width / 2 - box.left;
  const rectTop = rect.top - box.top + container.scrollTop;
  const rectBottom = rect.bottom - box.top + container.scrollTop;
  return {
    top: below ? rectBottom : rectTop,
    // Kept inside the viewer once its width is known (see the layout effect)
    left: center,
    below,
    rectTop,
    rectBottom,
  };
}

/** The range of a block's own text: a list item's, without the lists nested in it. */
function blockRange(block: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(block);
  const nested = block.tagName === "LI" ? block.querySelector(":scope > ul, :scope > ol") : null;
  if (nested !== null) range.setEndBefore(nested);
  return range;
}

/**
 * Run `change` keeping the text at the top of `container`'s view where it
 * is: the first block starting in view stays at the same height.
 */
function keepScrollAnchor(container: HTMLElement, article: HTMLElement, change: () => void): void {
  const top = container.getBoundingClientRect().top;
  const anchor = [...article.querySelectorAll(BLOCKS)].find(
    (el) => el.closest("[data-marks-skip]") === null && el.getBoundingClientRect().top >= top,
  );
  const before = anchor?.getBoundingClientRect().top;
  change();
  if (anchor !== undefined && before !== undefined && anchor.isConnected) {
    container.scrollTop += anchor.getBoundingClientRect().top - before;
  }
}

/** Bring `rect` to the upper third of `container`'s view. */
function scrollToRect(container: HTMLElement, rect: DOMRect): void {
  container.scrollTop += rect.top - container.getBoundingClientRect().top - container.clientHeight / 3;
}

/** A mark to scroll to once the document is shown; a new `nonce` asks again. */
export interface MarkFocus {
  target: { highlight: string } | { heading: BookmarkHeading };
  nonce: number;
}

/** A spot in the scroll container's content, for markers beside the text. */
interface Spot {
  top: number;
  left: number;
}

/** Text to highlight: its anchor, DOM range and text positions. */
interface Selected {
  anchor: TextAnchor;
  range: Range;
  start: number;
  end: number;
}

interface HeadingSpot extends Spot {
  heading: BookmarkHeading;
}

interface MarksLayerProps {
  /** The rendered document. */
  articleRef: React.RefObject<HTMLElement | null>;
  /** The viewer's scroll container; this layer is rendered inside it. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The document is rendered (not loading, no error). */
  ready: boolean;
  /** Changes whenever the rendered document does (another document, a reload). */
  renderKey: unknown;
  /** Show notes in the text under their passages (inlineNotes.ts), besides the margin icons. */
  inlineNotes?: boolean;
  highlights: readonly Highlight[];
  bookmarks: readonly Bookmark[];
  /** A mark of this document to scroll to. */
  focus: MarkFocus | null;
  onAdd: (anchor: TextAnchor, color: HighlightColor) => Promise<Highlight | null>;
  onRecolor: (id: string, color: HighlightColor) => void;
  onSetNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;
  onToggleBookmark: (heading: BookmarkHeading) => void;
  /** After painting: the highlights found in the text, by id, with their ranges. */
  onPainted?: (located: ReadonlyMap<string, Range>) => void;
}

/**
 * Highlights and heading bookmarks in the viewer: paints highlights over
 * the rendered document (CSS Custom Highlight API — the DOM React rendered
 * isn't changed), offers a toolbar for selected text and a popover for a
 * clicked highlight (colour, note, remove), marks highlights that have a
 * note, and shows a bookmark button beside headings.
 */
export default function MarksLayer({
  articleRef,
  containerRef,
  ready,
  renderKey,
  inlineNotes = false,
  highlights,
  bookmarks,
  focus,
  onAdd,
  onRecolor,
  onSetNote,
  onRemove,
  onToggleBookmark,
  onPainted,
}: MarksLayerProps): React.ReactElement | null {
  const located = useRef(new Map<string, Range>());
  // Their text positions, to find a highlight that already covers a block
  const spans = useRef(new Map<string, { start: number; end: number }>());
  const [toolbar, setToolbar] = useState<(Placement & Selected) | null>(null);
  const [popover, setPopover] = useState<(Placement & { id: string }) | null>(null);
  // The note being written in the popover (null: not editing)
  const [draft, setDraft] = useState<string | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>(loadColor);
  const [noteSpots, setNoteSpots] = useState<(Spot & { id: string })[]>([]);
  // The text of highlights that have a note: a block with some has no note button
  const [notedRanges, setNotedRanges] = useState<Range[]>([]);
  const [headingSpots, setHeadingSpots] = useState<HeadingSpot[]>([]);
  const [hoveredHeading, setHoveredHeading] = useState<number | null>(null);
  // The block the pointer is beside, for the note button in the margin
  const [hoveredBlock, setHoveredBlock] = useState<(Spot & { block: Element }) | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  // The highlight with a note under the pointer: its passage, inline note or
  // margin icon, which are all shown as hovered
  const [hoveredNote, setHoveredNote] = useState<string | null>(null);
  const notedIds = useRef(new Set<string>());
  // Read by the inline notes' cleanup: whether they're being turned off
  const inlineOn = useRef(inlineNotes);
  const popoverRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const handledFocus = useRef<number | null>(null);

  // ── Paint ──────────────────────────────────────────────────────────────────
  // Highlights that can't be found in the current text aren't painted
  // (they're kept, and listed as such in the Marks view)
  useEffect(() => {
    const article = articleRef.current;
    located.current = new Map();
    spans.current = new Map();
    if (!ready || article === null) {
      paint(new Map());
      onPainted?.(located.current);
      return;
    }
    const model = buildTextModel(article);
    const byColor = new Map<HighlightColor, Range[]>();
    for (const highlight of highlights) {
      const span = locateAnchor(model.text, highlight);
      if (span === null) continue;
      const range = model.range(span.start, span.end);
      located.current.set(highlight.id, range);
      spans.current.set(highlight.id, span);
      byColor.set(highlight.color, [...(byColor.get(highlight.color) ?? []), range]);
    }
    paint(byColor);
    onPainted?.(located.current);
    return () => paint(new Map());
  }, [articleRef, ready, renderKey, highlights, onPainted]);

  // Markers beside the text follow its layout (reading width, font size, window size)
  useEffect(() => {
    const article = articleRef.current;
    if (!ready || article === null) return;
    const observer = new ResizeObserver(() => setLayoutVersion((v) => v + 1));
    observer.observe(article);
    return () => observer.disconnect();
  }, [articleRef, ready, renderKey]);

  // ── Note markers and heading bookmark buttons ──────────────────────────────
  // Measured after painting, so markers appear with the highlights
  useLayoutEffect(() => {
    const article = articleRef.current;
    const container = containerRef.current;
    if (!ready || article === null || container === null) {
      setNoteSpots([]);
      setNotedRanges([]);
      setHeadingSpots([]);
      return;
    }
    const box = container.getBoundingClientRect();
    const spot = (rect: DOMRect, dx: number): Spot => ({
      top: rect.top - box.top + container.scrollTop + rect.height / 2,
      left: Math.max(4, rect.left - box.left + container.scrollLeft + dx),
    });

    // In the right margin, level with the highlight's last line, so they
    // don't cover the text after it
    const textRight = article.getBoundingClientRect().right - parseFloat(getComputedStyle(article).paddingRight);
    setNoteSpots(
      highlights.flatMap((h) => {
        const rects = h.note === null ? undefined : located.current.get(h.id)?.getClientRects();
        const last = rects?.[rects.length - 1];
        return last === undefined ? [] : [{ id: h.id, ...spot(last, textRight - last.left + NOTE_MARGIN) }];
      }),
    );

    setNotedRanges(highlights.flatMap((h) => (h.note === null ? [] : [located.current.get(h.id) ?? []].flat())));
    notedIds.current = new Set(highlights.flatMap((h) => (h.note === null ? [] : [h.id])));

    const elements = [...article.querySelectorAll<HTMLElement>(HEADINGS)];
    const identities = headingIdentities(elements.map(headingOf));
    setHeadingSpots(
      elements.map((el, i) => ({ heading: identities[i] as BookmarkHeading, ...spot(el.getBoundingClientRect(), -HEADING_ICON_OFFSET) })),
    );
  }, [articleRef, containerRef, ready, renderKey, highlights, layoutVersion]);

  // Which heading the pointer is beside, for its bookmark button, and which
  // block, for the note button: anywhere in its row, including the margins
  // the buttons sit in, so moving to a button doesn't hide it
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;
    if (!ready || container === null || article === null) return;
    let frame = 0;
    function onMouseMove(e: MouseEvent) {
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(frame);
      const target = e.target;
      frame = requestAnimationFrame(() => {
        if (article === null) return;
        // An inline note by its element; a passage by its painted text
        const linked = target instanceof Element ? target.closest<HTMLElement>("[data-highlight]") : null;
        let noteId = linked?.dataset.highlight ?? null;
        if (noteId === null) {
          for (const id of notedIds.current) {
            const rects = located.current.get(id)?.getClientRects() ?? [];
            if ([...rects].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) noteId = id;
          }
        }
        setHoveredNote(noteId);
        const index = [...article.querySelectorAll(HEADINGS)].findIndex((el) => {
          const r = el.getBoundingClientRect();
          return y >= r.top && y <= r.bottom && x >= r.left - HEADING_ICON_OFFSET - HEADING_ROW_SLACK && x <= r.right;
        });
        setHoveredHeading(index === -1 ? null : index);

        const textBox = article.getBoundingClientRect();
        const style = getComputedStyle(article);
        const textLeft = textBox.left + parseFloat(style.paddingLeft);
        const textRight = textBox.right - parseFloat(style.paddingRight);
        let block: Element | undefined;
        if (x >= textLeft - HEADING_ICON_OFFSET - HEADING_ROW_SLACK && x <= textRight + NOTE_MARGIN + NOTE_BUTTON_ROOM) {
          // In document order, a block comes before those inside it: the last one is the innermost
          for (const el of article.querySelectorAll(BLOCKS)) {
            const r = el.getBoundingClientRect();
            if (y >= r.top && y <= r.bottom && blockRange(el).toString().trim() !== "") block = el;
          }
        }
        // Level with the block's first line, in the right margin (as note markers)
        const first = block === undefined ? undefined : blockRange(block).getClientRects()[0];
        const container = containerRef.current;
        if (block === undefined || first === undefined || container === null) {
          setHoveredBlock(null);
          return;
        }
        const box = container.getBoundingClientRect();
        const spot = {
          top: first.top - box.top + container.scrollTop + first.height / 2,
          left: textRight - box.left + container.scrollLeft + NOTE_MARGIN,
        };
        setHoveredBlock((prev) =>
          prev !== null && prev.block === block && prev.top === spot.top && prev.left === spot.left ? prev : { block, ...spot },
        );
      });
    }
    const onMouseLeave = () => {
      cancelAnimationFrame(frame);
      setHoveredNote(null);
      setHoveredHeading(null);
      setHoveredBlock(null);
    };
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [articleRef, containerRef, ready, renderKey]);

  // ── Inline notes ───────────────────────────────────────────────────────────
  // After painting (declared after it), from the ranges it found. Placed
  // again by the watcher when React changes the document under them; turning
  // them on or off keeps the text at the top of the view in place.
  useLayoutEffect(() => {
    inlineOn.current = inlineNotes;
  }, [inlineNotes]);

  useEffect(() => {
    const article = articleRef.current;
    const container = containerRef.current;
    if (!ready || !inlineNotes || article === null || container === null) return;
    const notes = (): InlineNote[] =>
      highlights.flatMap((h) => {
        const range = h.note === null ? undefined : located.current.get(h.id);
        return range === undefined || h.note === null
          ? []
          : [{ id: h.id, range, color: `var(--mark-${h.color}-swatch)`, note: h.note }];
      });
    const relayout = () => setLayoutVersion((v) => v + 1);
    let stop = () => {};
    keepScrollAnchor(container, article, () => {
      stop = watchInlineNotes(article, notes, relayout);
    });
    return () => {
      if (inlineOn.current) stop();
      else keepScrollAnchor(container, article, stop);
    };
  }, [articleRef, containerRef, ready, renderKey, highlights, inlineNotes]);

  // The hovered note's passage and inline note
  useEffect(() => {
    const article = articleRef.current;
    const range = hoveredNote === null ? undefined : located.current.get(hoveredNote);
    if (article === null || hoveredNote === null || range === undefined) return;
    if (supported) CSS.highlights.set("folio-mark-hover", new Highlight(range));
    const linked = article.querySelectorAll(`[data-highlight="${CSS.escape(hoveredNote)}"]`);
    for (const el of linked) el.classList.add("folio-hovered");
    return () => {
      if (supported) CSS.highlights.delete("folio-mark-hover");
      for (const el of linked) el.classList.remove("folio-hovered");
    };
  }, [articleRef, hoveredNote, layoutVersion]);

  // ── Scroll to a mark (Marks view) ──────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;
    if (!ready || focus === null || container === null || article === null || handledFocus.current === focus.nonce) return;
    const { target, nonce } = focus;
    // After the viewer's own scrolling for the new document (top, anchor).
    // Only counted as done once it ran: a re-render may cancel the frame.
    const frame = requestAnimationFrame(() => {
      handledFocus.current = nonce;
      if ("highlight" in target) {
        const range = located.current.get(target.highlight);
        if (range !== undefined) scrollToRect(container, range.getBoundingClientRect());
        return;
      }
      const elements = [...article.querySelectorAll<HTMLElement>(HEADINGS)];
      const identities = headingIdentities(elements.map(headingOf));
      const element = elements[identities.findIndex((h) => sameHeading(h, target.heading))];
      if (element !== undefined) {
        container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [articleRef, containerRef, ready, focus, renderKey, highlights]);

  // Another document: nothing of the previous one stays open (reset while
  // rendering, when it changes, rather than in an effect)
  const [shownFor, setShownFor] = useState(renderKey);
  if (shownFor !== renderKey) {
    setShownFor(renderKey);
    setToolbar(null);
    setPopover(null);
    setDraft(null);
    setHoveredHeading(null);
    setHoveredBlock(null);
    setHoveredNote(null);
  }

  // A removed highlight's popover closes
  if (popover !== null && !highlights.some((h) => h.id === popover.id)) {
    setPopover(null);
    setDraft(null);
  }

  /** A highlight's popover, by `rect`; with `note`, writing its note. */
  const openPopover = useCallback(
    (id: string, rect: DOMRect, note: string | null = null) => {
      const container = containerRef.current;
      if (container === null) return;
      setPopover({ ...placeBy(container, rect, true), id });
      setDraft(note);
    },
    [containerRef],
  );

  /** The most recent highlight that shares text with `start`–`end`. */
  const highlightAt = useCallback((start: number, end: number): string | undefined => {
    return [...spans.current].reverse().find(([, s]) => s.start < end && s.end > start)?.[0];
  }, []);

  // ── Selection → toolbar ────────────────────────────────────────────────────
  /** The selected text in the document as an anchor, with its range and text positions. */
  const selectedAnchor = useCallback((): Selected | null => {
    const article = articleRef.current;
    const selection = window.getSelection();
    if (article === null || selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return null;
    const span = spanOf(article, range);
    return span === null ? null : { anchor: span.anchor, range: range.cloneRange(), start: span.start, end: span.end };
  }, [articleRef]);

  useEffect(() => {
    if (!ready) return;
    // Once a drag or Shift+arrows selection is finished, not while it changes
    const showForSelection = () => {
      setTimeout(() => {
        const container = containerRef.current;
        const selected = selectedAnchor();
        // Highlights don't overlap: text already highlighted shows that
        // highlight instead (to remove it first, for another)
        const existing = selected === null ? undefined : highlightAt(selected.start, selected.end);
        if (selected !== null && existing !== undefined) {
          setToolbar(null);
          openPopover(existing, selected.range.getBoundingClientRect());
          return;
        }
        setToolbar(
          selected === null || container === null
            ? null
            : { ...placeBy(container, selected.range.getBoundingClientRect(), false), ...selected },
        );
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") showForSelection();
    };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed !== false) setToolbar(null);
    };
    document.addEventListener("mouseup", showForSelection);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", showForSelection);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [ready, containerRef, selectedAnchor, highlightAt, openPopover]);

  /**
   * Highlight the selection; with `withNote`, then open its popover to write
   * one. Where some of it is highlighted already, that highlight's popover.
   */
  const highlightSelection = useCallback(
    (selected: Selected, color: HighlightColor, withNote = false) => {
      const existing = highlightAt(selected.start, selected.end);
      if (existing !== undefined) {
        setToolbar(null);
        const note = withNote ? (highlights.find((h) => h.id === existing)?.note ?? "") : null;
        openPopover(existing, selected.range.getBoundingClientRect(), note);
        return;
      }
      setLastColor(color);
      setItem(COLOR_KEY, color);
      window.getSelection()?.removeAllRanges();
      setToolbar(null);
      void onAdd(selected.anchor, color).then((highlight) => {
        const container = containerRef.current;
        if (!withNote || highlight === null || container === null) return;
        setPopover({ ...placeBy(container, selected.range.getBoundingClientRect(), true), id: highlight.id });
        setDraft("");
      });
    },
    [onAdd, containerRef, highlightAt, openPopover, highlights],
  );

  // ⇧⌘H / Ctrl+Shift+H (or Edit → Highlight Selection): the last colour
  useEffect(() => {
    const highlightNow = () => {
      const selected = selectedAnchor();
      if (selected === null) return false;
      highlightSelection(selected, lastColor);
      return true;
    };
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "h") return;
      if (highlightNow()) e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = window.markdownApi?.onFindCommand((command) => {
      if (command === "highlight") highlightNow();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [selectedAnchor, highlightSelection, lastColor]);

  // ── Click on a highlight → popover ─────────────────────────────────────────

  /** The note button beside a block: highlight it to write a note, or the note of a highlight in it. */
  const noteOnBlock = useCallback(
    (block: Element) => {
      const article = articleRef.current;
      const container = containerRef.current;
      if (article === null || container === null) return;
      const span = spanOf(article, blockRange(block));
      if (span === null) return;
      const range = span.model.range(span.start, span.end);
      highlightSelection({ anchor: span.anchor, range, start: span.start, end: span.end }, lastColor, true);
    },
    [articleRef, containerRef, highlightSelection, lastColor],
  );

  useEffect(() => {
    const article = articleRef.current;
    if (!ready || article === null) return;
    function onClick(e: MouseEvent) {
      if (window.getSelection()?.isCollapsed === false) return;
      // Links and buttons inside a highlight keep working
      if (e.target instanceof Element && e.target.closest("a, button")) return;
      // An inline note: the highlight's popover, by the note
      const inline = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-highlight]") : null;
      if (inline?.dataset.highlight !== undefined) {
        openPopover(inline.dataset.highlight, inline.getBoundingClientRect());
        return;
      }
      // The most recent highlight wins where they overlap
      for (const [id, range] of [...located.current].reverse()) {
        for (const rect of range.getClientRects()) {
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            openPopover(id, rect);
            return;
          }
        }
      }
    }
    article.addEventListener("click", onClick);
    return () => article.removeEventListener("click", onClick);
  }, [articleRef, ready, renderKey, openPopover]);

  const current = popover === null ? undefined : highlights.find((h) => h.id === popover.id);

  /** Close the popover, keeping a note being written. */
  const closePopover = useCallback(() => {
    if (current !== undefined && draft !== null && draft.trim() !== (current.note ?? "")) {
      onSetNote(current.id, draft.trim() === "" ? null : draft);
    }
    setPopover(null);
    setDraft(null);
  }, [current, draft, onSetNote]);

  // Escape (unless writing a note) or a click elsewhere closes the popover
  useEffect(() => {
    if (popover === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && draft === null) closePopover();
    }
    function onPointerDown(e: PointerEvent) {
      if (!(e.target instanceof Node && popoverRef.current?.contains(e.target))) closePopover();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [popover, draft, closePopover]);

  // The popover takes keyboard focus, so its buttons are reachable
  useEffect(() => {
    if (draft !== null) return; // the note field focuses itself
    popoverRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus();
  }, [popover?.id, draft]);

  // Keep the toolbar and popover inside the viewer by their actual width
  // (the note editor widens the popover), centred on the text when there's room
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const bubbles = [
      [toolbarRef.current, toolbar?.left],
      [popoverRef.current, popover?.left],
    ] as const;
    for (const [el, center] of bubbles) {
      if (el === null || center === undefined) continue;
      const half = el.offsetWidth / 2 + EDGE_GAP;
      el.style.left = `${Math.max(half, Math.min(center, container.clientWidth - half))}px`;
    }
  });

  // The popover goes below its highlight, or above it when there's no room
  // in the view below, else as low as fits: it never opens out of sight.
  // Placed again only when it opens or its note editor does, not as it's
  // written (nor moved when the view has been scrolled since).
  const popoverEditing = draft !== null;
  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = popoverRef.current;
    if (container === null || el === null || popover === null) return;
    const height = el.offsetHeight;
    const viewTop = container.scrollTop + EDGE_GAP;
    const viewBottom = container.scrollTop + container.clientHeight - EDGE_GAP;
    const below = popover.rectBottom + POPOVER_GAP;
    const above = popover.rectTop - POPOVER_GAP - height;
    const top = below + height <= viewBottom ? below : above >= viewTop ? above : Math.max(viewTop, viewBottom - height);
    el.style.top = `${top}px`;
    // Once placed, so focusing it doesn't scroll the view (as autoFocus would)
    if (popoverEditing) el.querySelector("textarea")?.focus({ preventScroll: true });
  }, [containerRef, popover, popoverEditing]);

  if (!ready) return null;

  /** A highlight with a note covers some of the block's text: its marker stands for the block's note. */
  const blockHasNote = (block: Element): boolean => {
    const own = blockRange(block);
    return notedRanges.some(
      (range) => range.compareBoundaryPoints(Range.START_TO_END, own) > 0 && range.compareBoundaryPoints(Range.END_TO_START, own) < 0,
    );
  };

  const hovered = hoveredHeading === null ? undefined : headingSpots[hoveredHeading];
  const headingButtons = headingSpots.filter(
    (spot) => findBookmark(bookmarks, spot.heading) !== undefined || spot === hovered,
  );

  return (
    <>
      {/* ── Heading bookmarks: bookmarked ones always, others on hover ── */}
      {headingButtons.map((spot) => {
        const marked = findBookmark(bookmarks, spot.heading) !== undefined;
        const label = `${marked ? "Remove bookmark" : "Bookmark"}: ${spot.heading.text}`;
        return (
          <button
            key={`${spot.heading.level}:${spot.heading.occurrence}:${spot.heading.text}`}
            type="button"
            className={`${styles.headingBookmark} ${marked ? styles.headingBookmarkOn : ""}`}
            style={{ top: spot.top, left: spot.left }}
            onClick={() => onToggleBookmark(spot.heading)}
            aria-pressed={marked}
            aria-label={label}
            title={marked ? "Remove bookmark" : "Bookmark this section"}
          >
            <BookmarkIcon filled={marked} />
          </button>
        );
      })}

      {/* ── The block beside the pointer: a note on it ── */}
      {hoveredBlock !== null && !blockHasNote(hoveredBlock.block) && (
          <button
            type="button"
            className={styles.blockNote}
            style={{ top: hoveredBlock.top, left: hoveredBlock.left }}
            onClick={() => noteOnBlock(hoveredBlock.block)}
            aria-label="Add a note to this section"
            title="Add a note"
          >
            <NoteIcon />
          </button>
        )}

      {/* ── Highlights with a note ── */}
      {noteSpots.map((spot) => {
        const highlight = highlights.find((h) => h.id === spot.id);
        return (
          <button
            key={spot.id}
            type="button"
            className={`${styles.noteMarker} ${spot.id === hoveredNote ? styles.noteMarkerHovered : ""}`}
            style={{ top: spot.top, left: spot.left }}
            onClick={(e) => openPopover(spot.id, e.currentTarget.getBoundingClientRect())}
            aria-label={`Note: ${highlight?.note ?? ""}`}
            title={highlight?.note ?? undefined}
          >
            <NoteIcon />
          </button>
        );
      })}

      {/* ── Selection toolbar ── */}
      {toolbar !== null && (
        <div
          className={`${styles.bubble} ${toolbar.below ? styles.below : styles.above}`}
          ref={toolbarRef}
          style={{ top: toolbar.top, left: toolbar.left }}
          role="toolbar"
          aria-label="Highlight the selection"
          // Clicking the toolbar mustn't clear the selection it acts on
          onMouseDown={(e) => e.preventDefault()}
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`${styles.swatch} ${styles[color]}`}
              onClick={() => highlightSelection(toolbar, color)}
              aria-label={`Highlight ${COLOR_NAMES[color].toLowerCase()}`}
              title={
                color === lastColor
                  ? `Highlight ${COLOR_NAMES[color].toLowerCase()} (${HIGHLIGHT_SHORTCUT})`
                  : `Highlight ${COLOR_NAMES[color].toLowerCase()}`
              }
            />
          ))}
          <span className={styles.divider} aria-hidden="true" />
          <button
            type="button"
            className={styles.action}
            onClick={() => highlightSelection(toolbar, lastColor, true)}
            aria-label="Add note"
            title="Add note"
          >
            <NoteIcon />
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              const text = window.getSelection()?.toString() ?? "";
              void navigator.clipboard?.writeText(text);
              setToolbar(null);
            }}
            aria-label="Copy"
            title="Copy"
          >
            {/* Two overlapping pages */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="9" rx="1" />
              <path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Highlight popover: colour, note, remove ── */}
      {popover !== null && current !== undefined && (
        <div
          ref={popoverRef}
          className={`${styles.bubble} ${styles.popover} ${draft !== null || current.note !== null ? styles.popoverWide : ""}`}
          // Its top is set once its height is known (see the layout effect)
          style={{ left: popover.left }}
          role="dialog"
          aria-label="Highlight"
        >
          <div className={styles.row}>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`${styles.swatch} ${styles[color]} ${color === current.color ? styles.swatchOn : ""}`}
                onClick={() => {
                  if (color !== current.color) onRecolor(current.id, color);
                }}
                aria-pressed={color === current.color}
                aria-label={COLOR_NAMES[color]}
                title={COLOR_NAMES[color]}
              />
            ))}
            <span className={styles.divider} aria-hidden="true" />
            {draft === null && (
              <button
                type="button"
                className={styles.action}
                onClick={() => setDraft(current.note ?? "")}
                aria-label={current.note === null ? "Add note" : "Edit note"}
                title={current.note === null ? "Add note" : "Edit note"}
              >
                <NoteIcon />
              </button>
            )}
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                onRemove(current.id);
                setPopover(null);
                setDraft(null);
              }}
              aria-label="Remove highlight"
              title="Remove highlight"
            >
              {/* A bin */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
              </svg>
            </button>
          </div>

          {draft === null && current.note !== null && (
            <button type="button" className={styles.noteText} onClick={() => setDraft(current.note ?? "")} title="Edit note">
              {current.note}
            </button>
          )}

          {draft !== null && (
            <div className={styles.noteEditor}>
              <textarea
                className={styles.noteField}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    closePopover();
                  } else if (e.key === "Escape") {
                    // Cancel the edit, keep the popover
                    e.stopPropagation();
                    setDraft(null);
                  }
                }}
                aria-label="Note"
                placeholder="Write a note…"
                rows={5}
                maxLength={10_000}
              />
              <div className={styles.noteActions}>
                <span className={styles.noteHint}>{SAVE_SHORTCUT} to save · Esc to cancel</span>
                <button type="button" className={styles.saveBtn} onClick={closePopover}>
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** A DOM range's text in the document, without whitespace at either end, as an anchor. */
function spanOf(
  article: HTMLElement,
  range: Range,
): { anchor: TextAnchor; start: number; end: number; model: ReturnType<typeof buildTextModel> } | null {
  const model = buildTextModel(article);
  let start = model.offsetOf(range.startContainer, range.startOffset);
  let end = model.offsetOf(range.endContainer, range.endOffset);
  // Not the whitespace a drag or double-click picks up at either end
  while (start < end && /\s/.test(model.text[start] ?? "")) start++;
  while (end > start && /\s/.test(model.text[end - 1] ?? "")) end--;
  if (end <= start) return null;
  return { anchor: describeSpan(model.text, start, end), start, end, model };
}

/** A heading element's level and text, as the scanner reads headings (whitespace collapsed). */
function headingOf(el: Element): { level: number; text: string } {
  return { level: Number(el.tagName.slice(1)), text: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
}

function NoteIcon(): React.ReactElement {
  // A speech bubble
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  );
}

export function BookmarkIcon({ filled }: { filled: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2h8v12l-4-3-4 3z" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}
