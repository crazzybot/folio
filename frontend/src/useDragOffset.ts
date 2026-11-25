import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DragOffset {
  x: number;
  y: number;
}

const NONE: DragOffset = { x: 0, y: 0 };

// What keeps its own pointer behaviour: a press on it doesn't drag
const INTERACTIVE = "button, a, input, textarea, select, label, [contenteditable]";

/**
 * Move a floating panel by dragging its handle, out of the way of the text
 * under it. The offset is added to wherever the panel places itself, so its
 * own placement stays as it is; `reset` puts it back (a panel opened again).
 */
export function useDragOffset(): {
  offset: DragOffset;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  reset: () => void;
} {
  const [offset, setOffset] = useState<DragOffset>(NONE);
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ x: number; y: number; offset: DragOffset } | null>(null);
  const stop = useRef<() => void>(() => {});

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest(INTERACTIVE))) return;
      // No text selected on the way
      e.preventDefault();
      from.current = { x: e.clientX, y: e.clientY, offset };
      setDragging(true);
      function onMove(ev: PointerEvent) {
        const start = from.current;
        if (start === null) return;
        // The pointer kept in the window, so the handle can't be dragged out of reach
        const x = Math.max(0, Math.min(ev.clientX, window.innerWidth));
        const y = Math.max(0, Math.min(ev.clientY, window.innerHeight));
        setOffset({ x: start.offset.x + x - start.x, y: start.offset.y + y - start.y });
      }
      function onUp() {
        stop.current();
      }
      stop.current = () => {
        from.current = null;
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stop.current = () => {};
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [offset],
  );

  const reset = useCallback(() => {
    stop.current();
    setOffset(NONE);
  }, []);

  useEffect(() => () => stop.current(), []);

  return { offset, dragging, onPointerDown, reset };
}
