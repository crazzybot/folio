import { useCallback, useState } from "react";

/**
 * Reading preferences chosen in the header's display options menu, each
 * remembered per browser / desktop install in localStorage. Applied as CSS
 * variables on the app root (see App.tsx and MarkdownViewer.module.css).
 */

/** How wide the rendered document may grow. */
export const READING_WIDTHS = [
  { id: "narrow", label: "Narrow", value: "720px" },
  { id: "medium", label: "Medium", value: "880px" },
  { id: "wide", label: "Wide", value: "1200px" },
  { id: "full", label: "Full", value: "none" },
] as const;

/** Base font size of the rendered document; headings and code scale with it. */
export const FONT_SIZES = [
  { id: "small", label: "Small", value: "13px" },
  { id: "medium", label: "Medium", value: "14px" },
  { id: "large", label: "Large", value: "16px" },
  { id: "x-large", label: "Extra large", value: "18px" },
] as const;

export type ReadingWidth = (typeof READING_WIDTHS)[number];
export type FontSize = (typeof FONT_SIZES)[number];

interface Option {
  readonly id: string;
}

/** One of `options`, remembered under `storageKey`, with a setter taking an option id. */
function useStoredOption<T extends Option>(
  options: readonly T[],
  storageKey: string,
  fallback: T,
): [T, (id: T["id"]) => void] {
  const [current, setCurrent] = useState<T>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      // Storage unavailable: use the default
    }
    return options.find((o) => o.id === saved) ?? fallback;
  });

  const choose = useCallback(
    (id: T["id"]) => {
      const next = options.find((o) => o.id === id) ?? fallback;
      setCurrent(next);
      try {
        localStorage.setItem(storageKey, next.id);
      } catch {
        // Not remembered, but still applied
      }
    },
    [options, storageKey, fallback],
  );

  return [current, choose];
}

export function useReadingWidth(): [ReadingWidth, (id: ReadingWidth["id"]) => void] {
  return useStoredOption<ReadingWidth>(READING_WIDTHS, "folio.readingWidth", READING_WIDTHS[1]);
}

export function useFontSize(): [FontSize, (id: FontSize["id"]) => void] {
  return useStoredOption<FontSize>(FONT_SIZES, "folio.fontSize", FONT_SIZES[1]);
}
