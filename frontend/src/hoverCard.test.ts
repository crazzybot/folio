import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverIntent, placeCard } from "./hoverCard";
import type { CardAnchor } from "./hoverCard";

const box = { top: 100, bottom: 122, right: 260 };
const measure = () => box;

describe("HoverIntent", () => {
  let shown: (CardAnchor | null)[];
  let intent: HoverIntent;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    intent = new HoverIntent((anchor) => shown.push(anchor), 500);
  });
  afterEach(() => {
    intent.dispose();
    vi.useRealTimers();
  });

  const keys = () => shown.map((anchor) => anchor?.key ?? null);

  it("shows the first card after the delay", () => {
    intent.enter("a", measure);
    vi.advanceTimersByTime(499);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([{ key: "a", ...box }]);
  });

  it("restarts the wait when the pointer moves on before it shows", () => {
    intent.enter("a", measure);
    vi.advanceTimersByTime(300);
    intent.enter("b", measure);
    vi.advanceTimersByTime(300);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(keys()).toEqual(["b"]);
  });

  it("ignores moves within the same row", () => {
    intent.enter("a", measure);
    vi.advanceTimersByTime(300);
    intent.enter("a", measure);
    vi.advanceTimersByTime(200);
    intent.enter("a", measure);
    expect(keys()).toEqual(["a"]);
  });

  it("swaps to another row at once while a card shows", () => {
    intent.enter("a", measure);
    vi.advanceTimersByTime(500);
    intent.enter("b", measure);
    expect(keys()).toEqual(["a", "b"]);
  });

  it("swaps at once after a pause, but waits again after a dismiss", () => {
    intent.enter("a", measure);
    vi.advanceTimersByTime(500);
    intent.pause();
    intent.enter("b", measure);
    expect(keys()).toEqual(["a", null, "b"]);

    intent.dismiss();
    intent.enter("c", measure);
    expect(keys()).toEqual(["a", null, "b", null]);
    vi.advanceTimersByTime(500);
    expect(keys()).toEqual(["a", null, "b", null, "c"]);
  });

  it("cancels a pending card", () => {
    intent.enter("a", measure);
    intent.dismiss();
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual([]);
  });

  it("measures the row when the card shows, not when the pointer arrives", () => {
    let top = 100;
    intent.enter("a", () => ({ ...box, top }));
    top = 80; // scrolled while waiting
    vi.advanceTimersByTime(500);
    expect(shown[0]?.top).toBe(80);
  });
});

describe("placeCard", () => {
  const win = { width: 1200, height: 800 };
  const card = { width: 300, height: 120 };

  it("goes beside the sidebar at the row's height", () => {
    expect(placeCard(box, card, win)).toEqual({ left: 266, top: 100 });
  });

  it("moves up to stay inside the window", () => {
    expect(placeCard({ ...box, top: 750, bottom: 772 }, card, win)).toEqual({ left: 266, top: 672 });
  });

  it("moves left in a narrow window, and never past the edges", () => {
    expect(placeCard({ ...box, right: 1000 }, card, win)).toEqual({ left: 892, top: 100 });
    expect(placeCard(box, { width: 2000, height: 2000 }, win)).toEqual({ left: 8, top: 8 });
  });
});
