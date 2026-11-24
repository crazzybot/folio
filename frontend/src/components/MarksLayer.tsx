import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findPassage } from "../../../packages/core/src/sourceMap";
import { describeSpan, locateAnchor } from "../anchoring";
import { findBookmark, headingIdentities, sameHeading } from "../bookmarks";
import { getItem, setItem } from "../storage";
import { watchInlineNotes } from "../inlineNotes";
import type { InlineNote } from "../inlineNotes";
import { NOTE_ICON_LABELS } from "../noteIcons";
import type { NoteIconKind } from "../noteIcons";
import { agentNoteLabel, agentProgress, type AgentProgress, answeredBy, openOptions, optionsBefore, pickedOption, isPrivate, lastSent, loopKind, pickedUpBy, stateOf, UNRESOLVE_TITLE, unplacedFirst } from "../sending";
import { buildTextModel } from "../textModel";
import { locateSection, sameSection, sectionPath } from "../sectionAnchor";
import { canReply, newsOf, threadSummary } from "../threads";
import { HIGHLIGHT_COLORS } from "../types";
import type { Bookmark, BookmarkHeading, Highlight, HighlightColor, NoteState, Round, TextAnchor } from "../types";
import LockIcon from "./LockIcon";
import NoteStateIcon from "./NoteStateIcon";
import NoteThread from "./NoteThread";
import styles from "./MarksLayer.module.css";

// The colour ⌘⇧H and Add note use: the last one picked
const COLOR_KEY = "folio.highlightColor";
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const HIGHLIGHT_SHORTCUT = IS_MAC ? "⇧⌘H" : "Ctrl+Shift+H";
const SAVE_SHORTCUT = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const SEND_SHORTCUT = IS_MAC ? "⇧⌘↩" : "Ctrl+Shift+Enter";
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
// Notes kept on one heading sit one under another, this far apart
const MARKER_STEP = 22;
const DETACHED_LABEL = "The passage isn't in the text any more";
const REPLACED_LABEL = "Before the edit";

const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };

function loadColor(): HighlightColor {
  const saved = getItem(COLOR_KEY);
  return HIGHLIGHT_COLORS.find((c) => c === saved) ?? "yellow";
}

// The paint layers in index.css: each colour, its lighter paint for resolved
// notes, and the dashed underline of sent ones
const LAYERS = [
  ...HIGHLIGHT_COLORS.flatMap((c) => [`folio-mark-${c}`, `folio-mark-${c}-resolved`]),
  "folio-mark-sent",
];

/** The layers a highlight is painted in: its colour, lighter once resolved, underlined while it waits on the agent. */
function layersOf(h: Highlight): string[] {
  if (isPrivate(h)) return [`folio-mark-${h.color}`];
  const kind = loopKind(h);
  if (kind === "resolved") return [`folio-mark-${h.color}-resolved`];
  return kind === "sent" ? [`folio-mark-${h.color}`, "folio-mark-sent"] : [`folio-mark-${h.color}`];
}

/** Paint highlights by layer (::highlight(folio-mark-…) in index.css), under search and find. */
function paint(byLayer: ReadonlyMap<string, Range[]>): void {
  if (!supported) return;
  for (const name of LAYERS) {
    const ranges = byLayer.get(name) ?? [];
    if (ranges.length === 0) {
      CSS.highlights.delete(name);
      continue;
    }
    const highlight = new Highlight(...ranges);
    highlight.priority = -1;
    CSS.highlights.set(name, highlight);
  }
}

/** Whether a highlight has a marker in the margin: it has a note, or it's sent to the agent without one. */
function hasMarker(h: Highlight): boolean {
  return h.note !== null || h.private === false;
}

/** A highlight's note icon. */
export function noteIconOf(h: Highlight): NoteIconKind {
  return isPrivate(h) ? "private" : loopKind(h);
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
  /** top: the document's top, its header in view (the note on the document opens there). */
  target: { highlight: string } | { heading: BookmarkHeading } | { top: true };
  /**
   * A highlight's popover opens too, with its thread (the status bar's new
   * replies). One not found in the text always opens, from its chip.
   */
  open?: boolean;
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
  /** The document shown: another one closes what's open. */
  docKey: unknown;
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
  /** A note's place in the review loop: its state, or `private` (null: the default). */
  onSetLoop: (id: string, changes: { state?: NoteState; private?: boolean | null }) => void;
  /** The document's latest rounds, for when a note was sent. */
  rounds?: readonly Round[] | undefined;
  /** The agents in a review loop on the document ("Claude Code"): the note editor offers Send. */
  sendTo?: string | null;
  /** Save a highlight's note (undefined: unchanged) and send it to `sendTo` on its own. */
  onSaveAndSend?: ((id: string, note: string | null | undefined) => void) | undefined;
  /** Save the user's reply (replyId null: a new one) and send the note to `sendTo` on its own. */
  onReplyAndSend?: ((id: string, reply: { text: string; replyId: string | null; choice?: number | null }) => void) | undefined;
  /** The user's reply to a highlight's note; `choice`: the option of an agent's decision it picks. */
  onReply: (id: string, text: string, choice?: number) => void;
  /** The user's latest reply to a highlight's note, changed. */
  /** `choice`: undefined keeps the reply's pick, null takes it out. */
  onEditReply: (id: string, replyId: string, text: string, choice?: number | null) => void;
  /** The user's latest reply to a highlight's note, deleted before it's sent. */
  onDeleteReply: (id: string, replyId: string) => void;
  /** The user saw a highlight's thread (its popover opened with new replies). */
  onSeen: (id: string) => void;
  onToggleBookmark: (heading: BookmarkHeading) => void;
  /**
   * After painting: the highlights found in the text, by id, with their
   * ranges, and the notes whose passage wasn't found kept on a heading of its
   * section, with that heading.
   */
  onPainted?: (located: ReadonlyMap<string, Range>, atSection: ReadonlyMap<string, HTMLElement>) => void;
  /** Where a note's passage is now (placing-notes.md): saved whenever it changes. */
  onSetSection?: ((id: string, section: BookmarkHeading[]) => void) | undefined;
  /** The agent's passage, found in the text: saved as the highlight's quote. */
  onTakePassage?: ((id: string, replacement: Pick<TextAnchor, "quote" | "position">) => void) | undefined;
  /** Above the document: where highlights not found in its text are listed. */
  unplacedSlot?: HTMLElement | null;
  /** The same list in the pinned header's details, while they're open. */
  pinnedSlot?: HTMLElement | null;
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
  docKey,
  renderKey,
  inlineNotes = false,
  highlights,
  bookmarks,
  focus,
  onAdd,
  onRecolor,
  onSetNote,
  onRemove,
  onSetLoop,
  rounds,
  sendTo = null,
  onSaveAndSend,
  onReplyAndSend,
  onReply,
  onEditReply,
  onDeleteReply,
  onSeen,
  onToggleBookmark,
  onPainted,
  onSetSection,
  onTakePassage,
  unplacedSlot = null,
  pinnedSlot = null,
}: MarksLayerProps): React.ReactElement | null {
  const located = useRef(new Map<string, Range>());
  // Highlights not found in the text, listed above it; the ref as just painted
  const [unplacedIds, setUnplacedIds] = useState<ReadonlySet<string>>(() => new Set());
  const unplacedNow = useRef<ReadonlySet<string>>(new Set());
  // Notes whose passage wasn't found, kept on a heading of its section: the
  // heading's index among the document's headings; the ref as just painted
  const [sectionIds, setSectionIds] = useState<ReadonlyMap<string, number>>(() => new Map());
  const atSectionNow = useRef<ReadonlyMap<string, number>>(new Map());
  // Sections being saved, so a repaint before the save lands doesn't save again
  const sectionsSaving = useRef(new Map<string, string>());
  const setSection = useRef(onSetSection);
  // The agent's passages being taken as quotes, so a repaint before the save lands doesn't save again
  const passagesTaking = useRef(new Set<string>());
  const takePassage = useRef(onTakePassage);
  useLayoutEffect(() => {
    setSection.current = onSetSection;
    takePassage.current = onTakePassage;
  }, [onSetSection, onTakePassage]);
  // The strip shows resolved notes and bare highlights too
  const [allUnplaced, setAllUnplaced] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  // Their text positions, to find a highlight that already covers a block
  const spans = useRef(new Map<string, { start: number; end: number }>());
  const [toolbar, setToolbar] = useState<(Placement & Selected) | null>(null);
  const [popover, setPopover] = useState<(Placement & { id: string }) | null>(null);
  // The note being written in the popover (null: not editing)
  const [draft, setDraft] = useState<string | null>(null);
  // A reply being written in the popover's thread
  const [replying, setReplying] = useState(false);
  const [lastColor, setLastColor] = useState<HighlightColor>(loadColor);
  // detached: kept on its section's heading, its passage not found
  const [noteSpots, setNoteSpots] = useState<(Spot & { id: string; detached: boolean })[]>([]);
  // The headings notes are kept on: no note button beside them
  const [notedHeadings, setNotedHeadings] = useState<Element[]>([]);
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
  // Across a reload: the open highlight, and its height in the view before it
  const keepInView = useRef<{ id: string; offset: number } | null>(null);
  // The highlight whose note was sent from the open popover: it stays open
  // for the answer, even if the agent's edit takes the passage away
  const sentFrom = useRef<string | null>(null);

  // ── Paint ──────────────────────────────────────────────────────────────────
  // Highlights that can't be found in the current text aren't painted. A
  // note is kept on a heading of the section it was in, while there's one
  // (placing-notes.md); others are listed above the document and in the
  // Marks view
  useEffect(() => {
    const article = articleRef.current;
    located.current = new Map();
    spans.current = new Map();
    const unplaced = new Set<string>();
    const atSection = new Map<string, number>();
    let elements: HTMLElement[] = [];
    const report = () => {
      unplacedNow.current = unplaced;
      atSectionNow.current = atSection;
      setUnplacedIds((prev) => (sameIds(prev, unplaced) ? prev : unplaced));
      setSectionIds((prev) => (sameIndexes(prev, atSection) ? prev : atSection));
      const headings = new Map<string, HTMLElement>();
      for (const [id, at] of atSection) {
        const element = elements[at];
        if (element !== undefined) headings.set(id, element);
      }
      onPainted?.(located.current, headings);
    };
    if (!ready || article === null) {
      paint(new Map());
      report();
      return;
    }
    const model = buildTextModel(article);
    const outline = headingsOf(article);
    elements = outline.elements;
    const byLayer = new Map<string, Range[]>();
    for (const highlight of highlights) {
      const span = locate(model.text, highlight);
      // The agent's passage found: it becomes the quote
      const taking = highlight.passage === undefined ? null : `${highlight.id} ${highlight.passage.at}`;
      if (span !== null && taking !== null && !passagesTaking.current.has(taking)) {
        passagesTaking.current.add(taking);
        const { quote, position } = describeSpan(model.text, span.start, span.end);
        takePassage.current?.(highlight.id, { quote, position });
      }
      if (span === null) {
        const at = hasMarker(highlight) && highlight.section !== undefined ? locateSection(outline.headings, highlight.section) : null;
        if (at === null) unplaced.add(highlight.id);
        else atSection.set(highlight.id, at);
        continue;
      }
      const range = model.range(span.start, span.end);
      located.current.set(highlight.id, range);
      spans.current.set(highlight.id, span);
      for (const layer of layersOf(highlight)) byLayer.set(layer, [...(byLayer.get(layer) ?? []), range]);
      // Its section kept up to date, for when the passage goes (notes made
      // before sections were kept get one here)
      if (hasMarker(highlight)) {
        const path = sectionPath(outline.headings, headingBefore(outline.elements, range.startContainer));
        const key = JSON.stringify(path);
        if (!sameSection(path, highlight.section) && sectionsSaving.current.get(highlight.id) !== key) {
          sectionsSaving.current.set(highlight.id, key);
          setSection.current?.(highlight.id, path);
        }
      }
    }
    paint(byLayer);
    report();
    return () => paint(new Map());
  }, [articleRef, ready, renderKey, highlights, onPainted]);

  // Markers beside the text follow its layout (reading width, font size,
  // window size), and the strip above it, which moves the text as it changes
  useEffect(() => {
    const article = articleRef.current;
    if (!ready || article === null) return;
    const observer = new ResizeObserver(() => setLayoutVersion((v) => v + 1));
    observer.observe(article);
    if (unplacedSlot !== null) observer.observe(unplacedSlot);
    return () => observer.disconnect();
  }, [articleRef, ready, renderKey, unplacedSlot]);

  // ── Note markers and heading bookmark buttons ──────────────────────────────
  // Measured after painting, so markers appear with the highlights
  useLayoutEffect(() => {
    const article = articleRef.current;
    const container = containerRef.current;
    if (!ready || article === null || container === null) {
      setNoteSpots([]);
      setNotedRanges([]);
      setNotedHeadings([]);
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
    const elements = [...article.querySelectorAll<HTMLElement>(HEADINGS)];
    // Notes kept on a heading: level with it, one under another (the margin has room for one across)
    const onHeading = new Map<number, number>();
    setNoteSpots(
      highlights.flatMap((h): (Spot & { id: string; detached: boolean })[] => {
        const at = sectionIds.get(h.id);
        const heading = at === undefined ? undefined : elements[at];
        if (at !== undefined && heading !== undefined) {
          const n = onHeading.get(at) ?? 0;
          onHeading.set(at, n + 1);
          const rect = heading.getBoundingClientRect();
          const first = spot(rect, textRight - rect.left + NOTE_MARGIN);
          return [{ id: h.id, detached: true, top: first.top + n * MARKER_STEP, left: first.left }];
        }
        const rects = hasMarker(h) ? located.current.get(h.id)?.getClientRects() : undefined;
        const last = rects?.[rects.length - 1];
        return last === undefined ? [] : [{ id: h.id, detached: false, ...spot(last, textRight - last.left + NOTE_MARGIN) }];
      }),
    );
    setNotedHeadings([...onHeading.keys()].flatMap((at) => [elements[at] ?? []].flat()));

    setNotedRanges(highlights.flatMap((h) => (h.note === null ? [] : [located.current.get(h.id) ?? []].flat())));
    notedIds.current = new Set(highlights.flatMap((h) => (h.note === null ? [] : [h.id])));

    const identities = headingIdentities(elements.map(headingOf));
    setHeadingSpots(
      elements.map((el, i) => ({ heading: identities[i] as BookmarkHeading, ...spot(el.getBoundingClientRect(), -HEADING_ICON_OFFSET) })),
    );
  }, [articleRef, containerRef, ready, renderKey, highlights, layoutVersion, sectionIds]);

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
          : [{ id: h.id, range, color: `var(--mark-${h.color}-swatch)`, note: h.note, by: agentNoteLabel(h), icon: noteIconOf(h), replies: threadSummary(h) }];
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

  // ── Scroll to a mark (Marks view) ──────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;
    if (!ready || focus === null || container === null || article === null || handledFocus.current === focus.nonce) return;
    const { target, nonce } = focus;
    // After the viewer's own scrolling for the new document (top, anchor).
    // Only counted as done once it ran: a re-render may cancel the frame.
    const frame = requestAnimationFrame(() => {
      if ("top" in target) {
        handledFocus.current = nonce;
        container.scrollTop = 0;
        return;
      }
      if ("highlight" in target) {
        const id = target.highlight;
        const range = located.current.get(id);
        const at = atSectionNow.current.get(id);
        const heading = at === undefined ? undefined : article.querySelectorAll<HTMLElement>(HEADINGS)[at];
        if (range === undefined && heading !== undefined) {
          // Kept on its section's heading: the heading, with the note open
          handledFocus.current = nonce;
          const padding = parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
          container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top - 16 - padding;
          openPopover(id, heading.getBoundingClientRect());
          return;
        }
        if (range === undefined) {
          // Not in the text: its chip above it, with the thread open, once
          // the strip shows it (the effect runs again when it changes)
          if (!unplacedNow.current.has(id)) {
            handledFocus.current = nonce;
            return;
          }
          const chip = stripRef.current?.querySelector(`[data-highlight-id="${CSS.escape(id)}"]`);
          if (chip == null) {
            const highlight = highlights.find((h) => h.id === id);
            if (highlight !== undefined && !unplacedFirst(highlight)) setAllUnplaced(true);
            return;
          }
          handledFocus.current = nonce;
          container.scrollTop += chip.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
          openPopover(id, chip.getBoundingClientRect());
          return;
        }
        handledFocus.current = nonce;
        scrollToRect(container, range.getBoundingClientRect());
        // Placed where the highlight is once scrolled
        if (focus.open === true) openPopover(target.highlight, range.getBoundingClientRect());
        return;
      }
      handledFocus.current = nonce;
      const elements = [...article.querySelectorAll<HTMLElement>(HEADINGS)];
      const identities = headingIdentities(elements.map(headingOf));
      const element = elements[identities.findIndex((h) => sameHeading(h, target.heading))];
      if (element !== undefined) {
        // Below the document header's pinned bar, if any
        const padding = parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
        container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - 16 - padding;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [articleRef, containerRef, ready, focus, renderKey, highlights, openPopover, unplacedIds, sectionIds, allUnplaced]);

  // Another document: nothing of the previous one stays open. A reload of
  // the same one keeps the open highlight's popover, and its note being
  // written, where it is on screen (see below). Reset while rendering, when
  // it changes, rather than in an effect
  const [shownFor, setShownFor] = useState({ docKey, renderKey });
  if (shownFor.renderKey !== renderKey || shownFor.docKey !== docKey) {
    setShownFor({ docKey, renderKey });
    setToolbar(null);
    if (shownFor.docKey !== docKey) {
      setPopover(null);
      setDraft(null);
      setUnplacedIds(new Set());
      setSectionIds(new Map());
      setAllUnplaced(false);
    }
    setHoveredHeading(null);
    setHoveredBlock(null);
    setHoveredNote(null);
  }

  // The open highlight's height in the view, kept as the view scrolls: a
  // reload changes the text before any effect could measure it
  const popoverId = popover?.id ?? null;
  useEffect(() => {
    const container = containerRef.current;
    if (popoverId === null || container === null) {
      keepInView.current = null;
      return;
    }
    const measure = () => {
      const range = located.current.get(popoverId);
      if (range !== undefined && range.startContainer.isConnected) {
        keepInView.current = { id: popoverId, offset: range.getBoundingClientRect().top - container.getBoundingClientRect().top };
      }
    };
    measure();
    container.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      container.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // Again once painting has found the highlight in new text
  }, [containerRef, popoverId, layoutVersion, renderKey, highlights]);

  // After a reload: the open highlight back at the height it was (text the
  // agent added above it would push it, and its popover, out of view), and
  // the popover beside it. Gone from the text: the popover closes, unless
  // the highlight was already listed above the text, where it stays
  useLayoutEffect(() => {
    const keep = keepInView.current;
    const article = articleRef.current;
    const container = containerRef.current;
    if (popoverId === null || !ready || article === null || container === null) return;
    const highlight = highlights.find((h) => h.id === popoverId);
    const model = buildTextModel(article);
    const span = highlight === undefined ? null : locate(model.text, highlight);
    if (span === null) {
      // Kept on its section's heading: beside it
      const { elements, headings } = headingsOf(article);
      const at = highlight?.section === undefined || !hasMarker(highlight) ? null : locateSection(headings, highlight.section);
      const heading = at === null ? undefined : elements[at];
      if (heading !== undefined) {
        setPopover({ ...placeBy(container, heading.getBoundingClientRect(), true), id: popoverId });
        return;
      }
      if (stripRef.current?.querySelector(`[data-highlight-id="${CSS.escape(popoverId)}"]`) != null) return;
      // Waiting for the agent's answer: where it was, not gone mid-conversation
      if (sentFrom.current === popoverId) return;
      setPopover(null);
      setDraft(null);
      return;
    }
    const range = model.range(span.start, span.end);
    if (keep !== null && keep.id === popoverId) {
      container.scrollTop += range.getBoundingClientRect().top - container.getBoundingClientRect().top - keep.offset;
    }
    setPopover({ ...placeBy(container, range.getBoundingClientRect(), true), id: popoverId });
    // Only after a reload: the popover and highlights of that render are read, not watched
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  // A removed highlight's popover closes
  if (popover !== null && !highlights.some((h) => h.id === popover.id)) {
    setPopover(null);
    setDraft(null);
  }


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
        // A note with replies isn't edited: its popover shows the conversation instead
        const found = highlights.find((h) => h.id === existing);
        const note = withNote && (found?.replies?.length ?? 0) === 0 ? (found?.note ?? "") : null;
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
  // Replied to, or the agent's own: the note is part of the conversation, and stays as it was written
  const answered = (current?.replies?.length ?? 0) > 0 || current?.author?.kind === "agent";

  // The answer to an agent's decision being written: an option picked (or
  // none) and a comment. It's the user's reply, saved or sent as any is;
  // the decision's one reply box
  const [pick, setPick] = useState<{ id: string; choice: number | null; comment: string } | null>(null);

  /** Close the popover, keeping a note being written. */
  const closePopover = useCallback(() => {
    if (current !== undefined && draft !== null && draft.trim() !== (current.note ?? "")) {
      onSetNote(current.id, draft.trim() === "" ? null : draft);
    }
    sentFrom.current = null;
    setPopover(null);
    setDraft(null);
    setPick(null);
    setReplying(false);
  }, [current, draft, onSetNote]);

  // Send: the note goes to the agents in a loop on the document at once,
  // without the Send dialog, and the popover stays open for the answer, as
  // in a chat. Not for a private note, which is never sent.
  // Decided on the draft: a new highlight has no note yet, so is private
  // until the note being written is saved
  const canSend =
    sendTo !== null &&
    onSaveAndSend !== undefined &&
    current !== undefined &&
    !isPrivate({ note: draft ?? current.note, private: current.private });
  const saveAndSend = () => {
    if (!canSend || draft === null) return;
    const note = draft.trim() === "" ? null : draft;
    onSaveAndSend(current.id, draft.trim() === (current.note ?? "") ? undefined : note);
    sentFrom.current = current.id;
    setDraft(null);
    setReplying(false);
  };
  // The options the agent offers now: its decision's, or those of its latest
  // reply. Once it answers without any, the thread is an ordinary one
  const offered = current === undefined ? undefined : openOptions(current);
  const deciding = offered !== undefined;
  // The message offering them, whose options are the buttons: a reply's id, or "note"
  const openFrom =
    offered === undefined ? null : ([...(current?.replies ?? [])].reverse().find((r) => r.author.kind === "agent")?.id ?? "note");
  const picking = deciding && pick !== null && pick.id === current?.id ? pick : null;
  // The user's answer so far, while unanswered: the box edits it rather than adding another
  const lastReply = current?.replies?.[current.replies.length - 1];
  const mine = deciding && lastReply?.author.kind === "user" ? lastReply : null;
  const optionText = (choice: number | null | undefined) => (choice == null ? undefined : offered?.[choice]);
  // The reply's text: the comment, or the option's when there's none
  const answerText = picking === null ? "" : picking.comment.trim() || (optionText(picking.choice) ?? "");
  const pickReady =
    picking !== null && answerText !== "" && (mine === null || answerText !== mine.text || picking.choice !== (mine.choice ?? null));
  const canSendPick = sendTo !== null && onReplyAndSend !== undefined && current !== undefined && !isPrivate(current);
  const startPick = (choice: number | null) => {
    if (current === undefined) return;
    // Editing the answer: its comment, not the option's text standing in for one
    const comment = picking?.comment ?? (mine === null || mine.text === optionText(mine.choice) ? "" : mine.text);
    setPick({ id: current.id, choice, comment });
    setReplying(true);
  };
  const savePick = (send: boolean) => {
    if (picking === null || current === undefined || !pickReady) return;
    const { choice } = picking;
    if (send) {
      if (!canSendPick) return;
      onReplyAndSend(current.id, { text: answerText, replyId: mine?.id ?? null, choice });
      sentFrom.current = current.id;
    } else if (mine === null) onReply(current.id, answerText, choice ?? undefined);
    else onEditReply(current.id, mine.id, answerText, choice);
    setPick(null);
    setReplying(false);
  };
  // The agent it went to, until it answers
  const progress = current === undefined ? null : agentProgress(current, rounds, current.id, sendTo);

  // Escape (unless writing a note) or a click elsewhere closes the popover
  useEffect(() => {
    if (popover === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && draft === null && !replying && pick === null) closePopover();
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
  }, [popover, draft, replying, pick, closePopover]);

  // Opening a note's thread shows its new replies: they're seen from then on.
  // Once for each latest message: marking seen changes the marks, which can
  // give onSeen a new identity, and must not mark it again
  const currentNews =
    current === undefined || newsOf(current) === "" ? null : `${current.id} ${current.replies?.[current.replies.length - 1]?.id ?? ""}`;
  const markedSeen = useRef<string | null>(null);
  useEffect(() => {
    if (popover === null || currentNews === null || markedSeen.current === currentNews) return;
    markedSeen.current = currentNews;
    onSeen(popover.id);
  }, [popover, currentNews, onSeen]);

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
  // Placed again only when it opens or its note editor or reply box does, not as it's
  // written (nor moved when the view has been scrolled since).
  const editingNote = draft !== null;
  const popoverEditing = editingNote || replying;
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
    if (editingNote) el.querySelector("textarea")?.focus({ preventScroll: true });
  }, [containerRef, popover, popoverEditing, editingNote]);

  if (!ready) return null;

  /** A highlight with a note covers some of the block's text: its marker stands for the block's note. */
  const blockHasNote = (block: Element): boolean => {
    if (notedHeadings.includes(block)) return true;
    const own = blockRange(block);
    return notedRanges.some(
      (range) => range.compareBoundaryPoints(Range.START_TO_END, own) > 0 && range.compareBoundaryPoints(Range.END_TO_START, own) < 0,
    );
  };

  const unplaced = highlights.filter((h) => unplacedIds.has(h.id));
  const unplacedShown = allUnplaced ? unplaced : unplaced.filter(unplacedFirst);
  const unplacedMore = unplaced.length - unplaced.filter(unplacedFirst).length;

  // The list of highlights not found in the text, above it and in the pinned header's details
  const strip = (
    <>
      <span className={styles.unplacedLabel}>Not found in the current text</span>
      <ul className={styles.unplacedList}>
        {unplacedShown.map((h) => {
          const kind = noteIconOf(h);
          const note = h.note ?? (h.private === false ? "(no comment)" : null);
          const fresh = newsOf(h);
          const news = fresh === "" ? "" : ` · ${fresh}`;
          const about = note === null ? "Highlight" : `${NOTE_ICON_LABELS[kind]} note: ${note}`;
          return (
            <li key={h.id}>
              <button
                type="button"
                data-highlight-id={h.id}
                className={`${styles.unplacedRow} ${fresh !== "" ? styles.noteMarkerNew : ""}`}
                style={{ borderLeftColor: `var(--mark-${h.color}-swatch)` }}
                onClick={(e) => openPopover(h.id, e.currentTarget.getBoundingClientRect())}
                aria-label={`${about}. On: ${h.quote.exact}${news}`}
                title={`${about}${news}`}
              >
                {note !== null && <NoteStateIcon kind={kind} size={12} />}
                <span className={styles.unplacedQuote}>{h.quote.exact}</span>
                {note !== null && <span className={styles.unplacedNote}>{note.split("\n")[0]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {unplacedMore > 0 && (
        <button
          type="button"
          className={styles.unplacedMore}
          onClick={() => setAllUnplaced((all) => !all)}
          aria-expanded={allUnplaced}
          title="Resolved notes and highlights without a note"
        >
          {allUnplaced ? "Show fewer" : unplacedShown.length === 0 ? `Show ${unplacedMore}` : `${unplacedMore} more`}
        </button>
      )}
    </>
  );

  const hovered = hoveredHeading === null ? undefined : headingSpots[hoveredHeading];
  const headingButtons = headingSpots.filter(
    (spot) => findBookmark(bookmarks, spot.heading) !== undefined || spot === hovered,
  );

  return (
    <>
      {/* ── Highlights not found in the text: above it, each opening its popover ── */}
      {unplaced.length > 0 &&
        unplacedSlot !== null &&
        createPortal(
          <div className={styles.unplaced} ref={stripRef} role="group" aria-label="Not found in the current text">
            {strip}
          </div>,
          unplacedSlot,
        )}
      {unplaced.length > 0 &&
        pinnedSlot !== null &&
        createPortal(
          <div className={styles.unplaced} role="group" aria-label="Not found in the current text">
            {strip}
          </div>,
          pinnedSlot,
        )}

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
        const kind = highlight === undefined ? "private" : noteIconOf(highlight);
        const note = highlight?.note ?? "(no comment)";
        const fresh = highlight === undefined ? "" : newsOf(highlight);
        const news = fresh === "" ? "" : ` · ${fresh}`;
        const detached = spot.detached ? ` · ${DETACHED_LABEL}` : "";
        return (
          <button
            key={spot.id}
            type="button"
            className={`${styles.noteMarker} ${spot.detached ? styles.noteMarkerDetached : ""} ${spot.id === hoveredNote ? styles.noteMarkerHovered : ""} ${fresh !== "" ? styles.noteMarkerNew : ""}`}
            style={{ top: spot.top, left: spot.left }}
            onClick={(e) => openPopover(spot.id, e.currentTarget.getBoundingClientRect())}
            aria-label={`${NOTE_ICON_LABELS[kind]} note: ${note}${news}${detached}`}
            title={(kind === "private" ? note : `${NOTE_ICON_LABELS[kind]} · ${note}`) + news + detached}
          >
            <NoteStateIcon kind={kind} />
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
          className={`${styles.bubble} ${styles.popover} ${draft !== null || current.note !== null || (current.replies?.length ?? 0) > 0 ? styles.popoverWide : ""}`}
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
            {draft === null && !answered && (
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
            {/* As a click elsewhere: a note being written is kept */}
            <button type="button" className={`${styles.action} ${styles.close}`} onClick={closePopover} aria-label="Close" title="Close (Escape)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.3" />
              </svg>
            </button>
          </div>

          {/* Kept on its section's heading: the passage it was on */}
          {sectionIds.has(current.id) && (
            <div className={styles.detached}>
              <span className={styles.detachedLabel}>{DETACHED_LABEL}</span>
              <del className={styles.detachedQuote}>{current.quote.exact}</del>
            </div>
          )}

          {/* The agent replaced the passage: what it was */}
          {current.replaced !== undefined && (
            <div className={styles.detached}>
              <span className={styles.detachedLabel}>{REPLACED_LABEL}</span>
              <del className={styles.detachedQuote}>{current.replaced.exact}</del>
            </div>
          )}

          {/* Answered: the note is the thread's first message, no longer editable */}
          {draft === null && current.note !== null && !answered && (
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
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey && canSend) {
                    e.preventDefault();
                    saveAndSend();
                  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
                <span className={styles.noteHint}>
                  {canSend ? `${SEND_SHORTCUT} to send` : `${SAVE_SHORTCUT} to save`} · Esc to cancel
                </span>
                {/* With an agent in the loop, Send is the main action: Save keeps the note for the next round, and closes */}
                <button
                  type="button"
                  className={canSend ? styles.secondaryBtn : styles.primaryBtn}
                  onClick={closePopover}
                  title={canSend ? `Save, to send with the next round (${SAVE_SHORTCUT})` : undefined}
                >
                  Save
                </button>
                {canSend && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={saveAndSend}
                    title={`Save, and send this note to ${sendTo} now (${SEND_SHORTCUT})`}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          )}

          {/* The thread: a note in the loop, or one that has replies */}
          {draft === null && (!isPrivate(current) || (current.replies?.length ?? 0) > 0) && (
            <NoteThread
              key={current.id}
              thread={current}
              note={answered && current.note !== null ? { text: current.note, author: current.author, at: current.created } : undefined}
              onReply={(text) => onReply(current.id, text)}
              onEditReply={(replyId, text) => onEditReply(current.id, replyId, text)}
              onDeleteReply={(replyId) => onDeleteReply(current.id, replyId)}
              onWritingChange={setReplying}
              sendTo={isPrivate(current) ? null : sendTo}
              onSaveAndSend={
                onReplyAndSend === undefined
                  ? undefined
                  : (reply) => {
                      onReplyAndSend(current.id, reply);
                      sentFrom.current = current.id;
                    }
              }
              progress={progress}
              // A decision being made has its own reply box, under its options
              offerReply={!deciding}
              optionsBefore={optionsBefore(current)}
              openFrom={openFrom}
              noteOptions={current.kind === "decision" && current.author?.kind === "agent" ? current.options : undefined}
            />
          )}

          {/* An agent's decision: the user picks one of its options, then saves or sends it as a reply */}
          {draft === null && offered !== undefined && (
            <div className={styles.options} role="group" aria-label="Options">
              {offered.map((option, i) => {
                const on = (picking === null ? (pickedOption(current) ?? null) : picking.choice) === i;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.option} ${on ? styles.optionOn : ""}`}
                    // Picked again: taken back
                    onClick={() => startPick(on ? null : i)}
                    aria-pressed={on}
                    title={on ? "Click again to take your choice back" : undefined}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
          {draft === null && deciding && picking === null && canReply(current) && (
            <button type="button" className={styles.replyBtn} onClick={() => startPick(null)}>
              Reply
            </button>
          )}
          {draft === null && picking !== null && (
            <div className={styles.noteEditor}>
              <textarea
                className={styles.noteField}
                value={picking.comment}
                onChange={(e) => setPick({ ...picking, comment: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey && canSendPick) {
                    e.preventDefault();
                    savePick(true);
                  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    savePick(false);
                  } else if (e.key === "Escape") {
                    // Cancel the pick, keep the popover
                    e.stopPropagation();
                    setPick(null);
                    setReplying(false);
                  }
                }}
                aria-label="Reply"
                placeholder={picking.choice === null ? "Reply… or pick an option above" : "Add a comment (optional)…"}
                rows={3}
                maxLength={10_000}
                autoFocus
              />
              <div className={styles.noteActions}>
                <span className={styles.noteHint}>
                  {canSendPick ? `${SEND_SHORTCUT} to send` : `${SAVE_SHORTCUT} to save`} · Esc to cancel
                </span>
                {/* With an agent in the loop, Send is the main action: Save keeps the choice for the next round */}
                <button
                  type="button"
                  className={canSendPick ? styles.secondaryBtn : styles.primaryBtn}
                  onClick={() => savePick(false)}
                  disabled={!pickReady}
                  title={canSendPick ? `Save, to send with the next round (${SAVE_SHORTCUT})` : undefined}
                >
                  Save
                </button>
                {canSendPick && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => savePick(true)}
                    disabled={!pickReady}
                    title={`Save, and send your answer to ${sendTo} now (${SEND_SHORTCUT})`}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          )}

          {draft === null && (
            <LoopRow
              highlight={current}
              rounds={rounds}
              progress={progress}
              onSetLoop={(changes) => {
                onSetLoop(current.id, changes);
                // Resolving, unresolving or marking not sent is done with the note, as on the document's note
                if (changes.state !== undefined) closePopover();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * The popover's last row: where the note is in the review loop, what can
 * be done about it, and the lock that keeps it to the user
 * (docs/design/sending-notes.md §2).
 */
function LoopRow({
  highlight,
  rounds,
  progress,
  onSetLoop,
}: {
  highlight: Highlight;
  rounds: readonly Round[] | undefined;
  /** Shown above it: who has the note is said there. */
  progress: AgentProgress | null;
  onSetLoop: (changes: { state?: NoteState; private?: boolean | null }) => void;
}): React.ReactElement {
  const bare = highlight.note === null;
  const locked = isPrivate(highlight);
  const state = stateOf(highlight);
  const answered = answeredBy(highlight);
  // The agent's own note, not answered yet: who's asking, rather than who answered
  const asked = (highlight.replies?.length ?? 0) === 0 ? agentNoteLabel(highlight) : null;
  const when = state === "sent" ? lastSent(rounds, highlight.id) : null;
  const pickedBy = state === "sent" && progress === null ? pickedUpBy(rounds, highlight.id) : null;
  const link = (label: string, changes: { state?: NoteState; private?: boolean | null }, title?: string) => (
    <button type="button" className={styles.loopBtn} onClick={() => onSetLoop(changes)} title={title}>
      {label}
    </button>
  );

  // A bare highlight is the reader's own until it's sent
  if (bare && locked) {
    return (
      <div className={styles.loopRow}>
        <span className={styles.loopStatus} />
        {link("Send to agent", { private: false }, "Send this highlight to the agent without a comment")}
      </div>
    );
  }

  return (
    <div className={styles.loopRow}>
      <span className={styles.loopStatus}>
        {!locked && state === "open" && (
          <>
            <NoteStateIcon kind="open" size={12} /> Not sent
          </>
        )}
        {!locked && answered !== null && (
          <>
            <NoteStateIcon kind="answered" size={12} /> {asked ?? `Answered by ${answered}`} · {link("Resolve", { state: "resolved" })}
          </>
        )}
        {!locked && state === "sent" && answered === null && (
          <>
            <NoteStateIcon kind="sent" size={12} /> Sent{when === null ? "" : ` · ${when}`}
            {pickedBy === null ? "" : ` · ${pickedBy} has it`} ·{" "}
            {link("Mark not sent", { state: "open" }, "It will be sent again next time")} ·{" "}
            {link("Resolve", { state: "resolved" })}
          </>
        )}
        {!locked && state === "addressed" && (
          <>
            <NoteStateIcon kind="addressed" size={12} /> {asked ?? "Addressed"} · {link("Resolve", { state: "resolved" })}
          </>
        )}
        {!locked && state === "resolved" && (
          <>
            <NoteStateIcon kind="resolved" size={12} /> Resolved ·{" "}
            {link("Unresolve", { state: highlight.resolvedFrom ?? "open" }, UNRESOLVE_TITLE)}
          </>
        )}
      </span>
      <button
        type="button"
        className={`${styles.lock} ${locked ? styles.lockOn : ""}`}
        // Unlocking goes back to the default (feedback with a note); a bare highlight sent to the agent goes back to private
        onClick={() => onSetLoop({ private: locked || bare ? null : true })}
        aria-pressed={locked}
        title={locked ? "Only you see this note: click to send it with the others" : "Keep this note to yourself: it's never sent"}
      >
        <LockIcon locked={locked} /> Only me
      </button>
    </div>
  );
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * Where a highlight is in the text: the passage the agent says replaced its
 * quote, while that's waiting to be taken and is there, else its anchor.
 */
function locate(text: string, highlight: Highlight): { start: number; end: number } | null {
  const passage = highlight.passage === undefined ? null : findPassage(text, highlight.passage.exact, highlight.position.start);
  return passage ?? locateAnchor(text, highlight);
}

function sameIndexes(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([id, at]) => b.get(id) === at);
}

/** The document's headings in order: the elements, and their level and text. */
function headingsOf(article: HTMLElement): { elements: HTMLElement[]; headings: { level: number; text: string }[] } {
  const elements = [...article.querySelectorAll<HTMLElement>(HEADINGS)];
  return { elements, headings: elements.map(headingOf) };
}

/** The index of the last heading that `node` is in or after: -1 before the first. */
function headingBefore(elements: readonly Element[], node: Node): number {
  let found = -1;
  elements.forEach((el, i) => {
    if (el.contains(node) || el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = i;
  });
  return found;
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
  const { elements, headings } = headingsOf(article);
  const section = sectionPath(headings, headingBefore(elements, range.startContainer));
  const anchor = describeSpan(model.text, start, end);
  return { anchor: section.length === 0 ? anchor : { ...anchor, section }, start, end, model };
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
