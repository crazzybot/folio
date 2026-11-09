/**
 * useRowHoverCard.ts — The sidebar lists' hover card (Documents and Marks):
 * which row it is for, from the pointer or keyboard focus. The list spreads
 * `listProps` on its rows' container; rows carry `data-row` keys.
 */

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { HoverIntent } from "./hoverCard";
import type { CardAnchor } from "./hoverCard";

/** Whether `el` has focus from the keyboard (not a click), as :focus-visible tells. */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** `showsCard(key)`: whether that row has a card (others pause it, as a row's buttons do). */
export function useRowHoverCard(showsCard: (key: string) => boolean): {
  /** The row the card is showing for, and where. */
  card: CardAnchor | null;
  listProps: Pick<
    React.HTMLAttributes<HTMLElement>,
    "onPointerOver" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur"
  >;
  /** Hide it; the next one waits again (a scroll, a key, the rows changing). */
  dismiss: () => void;
} {
  const [card, setCard] = useState<CardAnchor | null>(null);
  const [intent] = useState(() => new HoverIntent(setCard));
  useEffect(() => () => intent.dispose(), [intent]);
  const dismiss = useCallback(() => intent.dismiss(), [intent]);

  const hoverRow = (el: Element) => {
    const rowEl = el.closest<HTMLElement>("[data-row]");
    const key = rowEl?.dataset["row"];
    // A row's own button has its own tooltip
    if (rowEl === null || key === undefined || el.closest("button") !== null || !showsCard(key)) {
      intent.pause();
      return;
    }
    intent.enter(key, () => {
      const box = rowEl.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, right: box.right };
    });
  };

  return {
    card,
    dismiss,
    listProps: {
      onPointerOver: (e) => {
        if (e.pointerType !== "touch") hoverRow(e.target as Element);
      },
      onPointerLeave: dismiss,
      onPointerDown: dismiss,
      // From the keyboard, the focused row gets the card too
      onFocus: (e) => {
        if (isKeyboardFocus(e.target)) hoverRow(e.target);
      },
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) dismiss();
      },
    },
  };
}
