import React, { useCallback, useEffect, useRef, useState } from "react";
import { describeSpan, locateAnchor } from "../anchoring";
import { getItem, setItem } from "../storage";
import { buildTextModel } from "../textModel";
import { HIGHLIGHT_COLORS } from "../types";
import type { Highlight, HighlightColor, TextAnchor } from "../types";
import styles from "./MarksLayer.module.css";

// The colour ⌘⇧H uses: the last one picked
const COLOR_KEY = "folio.highlightColor";
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const HIGHLIGHT_SHORTCUT = IS_MAC ? "⇧⌘H" : "Ctrl+Shift+H";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;
// Room above a selection for the toolbar; with less, it goes below
const TOOLBAR_ROOM = 44;
// Half the toolbar's width, to keep it inside the viewer
const TOOLBAR_HALF_WIDTH = 80;

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
}

function placeBy(container: HTMLElement, rect: DOMRect, preferBelow: boolean): Placement {
  const box = container.getBoundingClientRect();
  const below = preferBelow || rect.top - box.top < TOOLBAR_ROOM;
  const center = rect.left + rect.width / 2 - box.left;
  return {
    top: (below ? rect.bottom : rect.top) - box.top + container.scrollTop,
    left: Math.max(TOOLBAR_HALF_WIDTH, Math.min(center, container.clientWidth - TOOLBAR_HALF_WIDTH)),
    below,
  };
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
  highlights: readonly Highlight[];
  onAdd: (anchor: TextAnchor, color: HighlightColor) => void;
  onRecolor: (id: string, color: HighlightColor) => void;
  onRemove: (id: string) => void;
}

/**
 * Highlights in the viewer: paints them over the rendered document (CSS
 * Custom Highlight API — the DOM React rendered isn't changed), offers a
 * toolbar for selected text, and a popover for a clicked highlight.
 */
export default function MarksLayer({
  articleRef,
  containerRef,
  ready,
  renderKey,
  highlights,
  onAdd,
  onRecolor,
  onRemove,
}: MarksLayerProps): React.ReactElement | null {
  const located = useRef(new Map<string, Range>());
  const [toolbar, setToolbar] = useState<(Placement & { anchor: TextAnchor }) | null>(null);
  const [popover, setPopover] = useState<(Placement & { id: string }) | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>(loadColor);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Paint ──────────────────────────────────────────────────────────────────
  // Highlights that can't be found in the current text aren't painted
  // (they're kept, and will be listed as such in the Marks view)
  useEffect(() => {
    const article = articleRef.current;
    located.current = new Map();
    if (!ready || article === null) {
      paint(new Map());
      return;
    }
    const model = buildTextModel(article);
    const byColor = new Map<HighlightColor, Range[]>();
    for (const highlight of highlights) {
      const span = locateAnchor(model.text, highlight);
      if (span === null) continue;
      const range = model.range(span.start, span.end);
      located.current.set(highlight.id, range);
      byColor.set(highlight.color, [...(byColor.get(highlight.color) ?? []), range]);
    }
    paint(byColor);
    return () => paint(new Map());
  }, [articleRef, ready, renderKey, highlights]);

  // Another document: nothing of the previous one stays open (reset while
  // rendering, when it changes, rather than in an effect)
  const [shownFor, setShownFor] = useState(renderKey);
  if (shownFor !== renderKey) {
    setShownFor(renderKey);
    setToolbar(null);
    setPopover(null);
  }

  // A removed highlight's popover closes
  if (popover !== null && !highlights.some((h) => h.id === popover.id)) setPopover(null);

  // ── Selection → toolbar ────────────────────────────────────────────────────
  /** The selected text in the document as an anchor, with its bounding box. */
  const selectedAnchor = useCallback((): { anchor: TextAnchor; rect: DOMRect } | null => {
    const article = articleRef.current;
    const selection = window.getSelection();
    if (article === null || selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return null;
    const model = buildTextModel(article);
    let start = model.offsetOf(range.startContainer, range.startOffset);
    let end = model.offsetOf(range.endContainer, range.endOffset);
    // Not the whitespace a drag or double-click picks up at either end
    while (start < end && /\s/.test(model.text[start] ?? "")) start++;
    while (end > start && /\s/.test(model.text[end - 1] ?? "")) end--;
    if (end <= start) return null;
    return { anchor: describeSpan(model.text, start, end), rect: range.getBoundingClientRect() };
  }, [articleRef]);

  useEffect(() => {
    if (!ready) return;
    // Once a drag or Shift+arrows selection is finished, not while it changes
    const showForSelection = () => {
      setTimeout(() => {
        const container = containerRef.current;
        const selected = selectedAnchor();
        setToolbar(
          selected === null || container === null
            ? null
            : { ...placeBy(container, selected.rect, false), anchor: selected.anchor },
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
  }, [ready, containerRef, selectedAnchor]);

  const highlightSelection = useCallback(
    (anchor: TextAnchor, color: HighlightColor) => {
      onAdd(anchor, color);
      setLastColor(color);
      setItem(COLOR_KEY, color);
      window.getSelection()?.removeAllRanges();
      setToolbar(null);
    },
    [onAdd],
  );

  // ⇧⌘H / Ctrl+Shift+H: highlight the selection in the last colour
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "h") return;
      const selected = selectedAnchor();
      if (selected === null) return;
      e.preventDefault();
      highlightSelection(selected.anchor, lastColor);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedAnchor, highlightSelection, lastColor]);

  // ── Click on a highlight → popover ─────────────────────────────────────────
  useEffect(() => {
    const article = articleRef.current;
    if (!ready || article === null) return;
    function onClick(e: MouseEvent) {
      const container = containerRef.current;
      if (container === null || window.getSelection()?.isCollapsed === false) return;
      // Links and buttons inside a highlight keep working
      if (e.target instanceof Element && e.target.closest("a, button")) return;
      // The most recent highlight wins where they overlap
      for (const [id, range] of [...located.current].reverse()) {
        for (const rect of range.getClientRects()) {
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            setPopover({ ...placeBy(container, rect, true), id });
            return;
          }
        }
      }
      setPopover(null);
    }
    article.addEventListener("click", onClick);
    return () => article.removeEventListener("click", onClick);
  }, [articleRef, containerRef, ready, renderKey]);

  // Escape or a click elsewhere closes the popover
  useEffect(() => {
    if (popover === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null);
    }
    function onPointerDown(e: PointerEvent) {
      if (!(e.target instanceof Node && popoverRef.current?.contains(e.target))) setPopover(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [popover]);

  // The popover takes keyboard focus, so its buttons are reachable
  useEffect(() => {
    popoverRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus();
  }, [popover?.id]);

  if (!ready) return null;
  const current = popover === null ? undefined : highlights.find((h) => h.id === popover.id);

  return (
    <>
      {toolbar !== null && (
        <div
          className={`${styles.bubble} ${toolbar.below ? styles.below : styles.above}`}
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
              onClick={() => highlightSelection(toolbar.anchor, color)}
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

      {popover !== null && current !== undefined && (
        <div
          ref={popoverRef}
          className={`${styles.bubble} ${styles.below}`}
          style={{ top: popover.top, left: popover.left }}
          role="dialog"
          aria-label="Highlight"
        >
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
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onRemove(current.id);
              setPopover(null);
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
      )}
    </>
  );
}
