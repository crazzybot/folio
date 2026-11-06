import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DiagramViewer.module.css";

interface DiagramViewerProps {
  /** The diagram's SVG markup (Mermaid's output, already sanitized). */
  svg: string;
  /** Background behind the diagram: its card colour, or the app's. */
  background: string;
  onClose: () => void;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEP = 1.25;
// Fit leaves a margin, and doesn't blow small diagrams up past this
const FIT_MARGIN = 0.92;
const FIT_MAX_SCALE = 2;
const PAN_STEP = 60;
// ⌘/Ctrl + wheel: trackpad pinches send small deltas, mouse wheels ~100 per
// notch; capping the delta makes a notch one zoom step and keeps pinch smooth
const WHEEL_ZOOM_RATE = 0.01;
const WHEEL_DELTA_CAP = 25;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * A diagram in the whole window, over the sidebar, header and outline:
 * zoom (buttons, ⌘/Ctrl + scroll or pinch, + / -), pan (drag, scroll,
 * arrow keys), fit and recentre (0), actual size (1); Escape closes.
 *
 * The SVG is scaled with a CSS transform, so it stays sharp at any zoom.
 */
export default function DiagramViewer({ svg, background, onClose }: DiagramViewerProps): React.ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);

  /** Scale and centre the whole diagram in the window. */
  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const { width, height } = sizeRef.current;
    const scale = clampScale(
      Math.min((stage.clientWidth * FIT_MARGIN) / width, (stage.clientHeight * FIT_MARGIN) / height, FIT_MAX_SCALE),
    );
    setView({ scale, x: (stage.clientWidth - width * scale) / 2, y: (stage.clientHeight - height * scale) / 2 });
  }, []);

  /**
   * Zoom to `nextScale(current scale)`, keeping the point (px, py) of the
   * stage where it is (the centre by default). Computed from the current
   * state, so fast wheel events don't lose steps.
   */
  const zoom = useCallback((nextScale: (scale: number) => number, px?: number, py?: number) => {
    const stage = stageRef.current;
    if (stage === null) return;
    const cx = px ?? stage.clientWidth / 2;
    const cy = py ?? stage.clientHeight / 2;
    setView((v) => {
      const scale = clampScale(nextScale(v.scale));
      const ratio = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  // Size the SVG at its natural size (from its viewBox), then fit it
  useLayoutEffect(() => {
    const el = contentRef.current?.querySelector("svg");
    if (!el) return;
    const box = el.viewBox.baseVal;
    const width = box && box.width > 0 ? box.width : el.getBoundingClientRect().width || 1;
    const height = box && box.height > 0 ? box.height : el.getBoundingClientRect().height || 1;
    sizeRef.current = { width, height };
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.maxWidth = "none";
    fit();
  }, [svg, fit]);

  // Focus the dialog; give focus back to what opened it on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Wheel: ⌘/Ctrl + scroll (and trackpad pinch, which reports ctrlKey) zooms
  // at the pointer; plain scroll pans. Needs a non-passive listener.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = stage!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, e.deltaY));
        const factor = Math.exp(-delta * WHEEL_ZOOM_RATE);
        zoom((scale) => scale * factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // Drag to pan
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Keep keyboard focus in the dialog, so its shortcuts keep working
    overlayRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag === null || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    dragRef.current = { ...drag, x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }
  function onPointerUp(e: React.PointerEvent) {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    const actions: Record<string, () => void> = {
      Escape: onClose,
      "+": () => zoom((scale) => scale * STEP),
      "=": () => zoom((scale) => scale * STEP),
      "-": () => zoom((scale) => scale / STEP),
      "0": fit,
      "1": () => zoom(() => 1),
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
    };
    const action = actions[e.key];
    if (action === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      className={styles.overlay}
      style={{ background }}
      role="dialog"
      aria-modal="true"
      aria-label="Diagram"
      onKeyDown={onKeyDown}
    >
      <div
        ref={stageRef}
        className={`${styles.stage} ${dragging ? styles.dragging : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          zoom((scale) => scale * 2, e.clientX - rect.left, e.clientY - rect.top);
        }}
      >
        <div
          ref={contentRef}
          className={styles.content}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div className={styles.toolbar} role="toolbar" aria-label="Diagram view">
        <button type="button" className={styles.btn} onClick={() => zoom((scale) => scale / STEP)} title="Zoom out (−)" aria-label="Zoom out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3.5 8h9" strokeWidth="1.3" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.zoomLevel}`}
          onClick={() => zoom(() => 1)}
          title="Actual size (1)"
          aria-label={`Zoom ${Math.round(view.scale * 100)}%, show actual size`}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" className={styles.btn} onClick={() => zoom((scale) => scale * STEP)} title="Zoom in (+)" aria-label="Zoom in">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3.5 8h9M8 3.5v9" strokeWidth="1.3" />
          </svg>
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button type="button" className={styles.btn} onClick={fit} title="Fit and centre (0)" aria-label="Fit and centre">
          {/* Four corners: fit to window */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
          </svg>
        </button>
        <button ref={closeRef} type="button" className={styles.btn} onClick={onClose} title="Close (Escape)" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.3" />
          </svg>
        </button>
      </div>

      <p className={styles.hint} aria-hidden="true">
        Drag or scroll to pan · ⌘ / Ctrl + scroll to zoom · Esc to close
      </p>
    </div>,
    document.body,
  );
}
