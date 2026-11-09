import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeCard } from "../hoverCard";
import type { CardAnchor } from "../hoverCard";
import styles from "./HoverCard.module.css";

interface HoverCardProps {
  anchor: CardAnchor;
  children: React.ReactNode;
}

/**
 * The sidebar's hover card: beside the list at the row's height, over the
 * document. In a portal, so the list's overflow doesn't clip it. Decorative
 * — the row's aria-label says the same — and never takes the pointer.
 */
export default function HoverCard({ anchor, children }: HoverCardProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Placed once its size is known, before it's painted
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setPosition(
      placeCard(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      className={styles.card}
      aria-hidden="true"
      style={position === null ? { visibility: "hidden" } : { left: position.left, top: position.top }}
    >
      {children}
    </div>,
    document.body,
  );
}
