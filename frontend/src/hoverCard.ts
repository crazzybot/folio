/**
 * hoverCard.ts — When the sidebar's hover card shows, and where.
 *
 * The first card appears after a pause over a row (or on it, from the
 * keyboard); while one is showing, moving to another row swaps it at once,
 * as macOS tooltips do. Leaving the list, scrolling, clicking or typing
 * dismisses it, and the next one waits again.
 */

export const HOVER_CARD_DELAY_MS = 500;
// Gap between the sidebar's edge and the card, and kept from the window's edges
const CARD_GAP = 6;
const WINDOW_MARGIN = 8;

export interface CardAnchor {
  /** The row the card is for. */
  key: string;
  /** The row's box, in viewport pixels. */
  top: number;
  bottom: number;
  right: number;
}

/** Shows and hides the card for rows; `onChange` receives the row to show it for, or null. */
export class HoverIntent {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: string | null = null;
  private shown: string | null = null;
  // A card showed and wasn't dismissed since: the next one shows at once
  private warm = false;

  constructor(
    private readonly onChange: (anchor: CardAnchor | null) => void,
    private readonly delay = HOVER_CARD_DELAY_MS,
  ) {}

  /** The pointer or keyboard focus is on a row: `measure` gives its box when the card shows. */
  enter(key: string, measure: () => Omit<CardAnchor, "key">): void {
    if (key === this.shown || key === this.pending) return;
    clearTimeout(this.timer);
    const reveal = () => {
      this.pending = null;
      this.shown = key;
      this.warm = true;
      this.onChange({ key, ...measure() });
    };
    if (this.warm) {
      reveal();
    } else {
      this.pending = key;
      this.timer = setTimeout(reveal, this.delay);
    }
  }

  /**
   * Off any row but still in the list (a "more" line, a row's button): the
   * card goes, and the next row's shows at once if one was showing.
   */
  pause(): void {
    clearTimeout(this.timer);
    this.pending = null;
    if (this.shown === null) return;
    this.shown = null;
    this.onChange(null);
  }

  /** Out of the list, a scroll, a click or a key: the card goes and the next one waits. */
  dismiss(): void {
    this.warm = false;
    this.pause();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

/**
 * Where the card goes: beside the sidebar at the row's height, moved up to
 * stay inside the window; never above its top.
 */
export function placeCard(
  anchor: Omit<CardAnchor, "key">,
  card: { width: number; height: number },
  window: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.min(anchor.right + CARD_GAP, window.width - WINDOW_MARGIN - card.width);
  const top = Math.min(anchor.top, window.height - WINDOW_MARGIN - card.height);
  return { left: Math.max(WINDOW_MARGIN, left), top: Math.max(WINDOW_MARGIN, top) };
}
