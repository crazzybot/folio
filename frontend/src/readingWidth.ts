import { useCallback, useState } from "react";

/** How wide the rendered document may grow; chosen in the header's display options menu. */
export const READING_WIDTHS = [
  { id: "narrow", label: "Narrow", maxWidth: "720px" },
  { id: "medium", label: "Medium", maxWidth: "880px" },
  { id: "wide", label: "Wide", maxWidth: "1200px" },
  { id: "full", label: "Full", maxWidth: "none" },
] as const;

export type ReadingWidth = (typeof READING_WIDTHS)[number];

const STORAGE_KEY = "folio.readingWidth";
const DEFAULT_WIDTH: ReadingWidth = READING_WIDTHS[1];

function load(): ReadingWidth {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: use the default
  }
  return READING_WIDTHS.find((w) => w.id === saved) ?? DEFAULT_WIDTH;
}

/** The reader's chosen width, remembered per browser / desktop install, and a setter taking a width id. */
export default function useReadingWidth(): [ReadingWidth, (id: ReadingWidth["id"]) => void] {
  const [width, setWidth] = useState(load);

  const choose = useCallback((id: ReadingWidth["id"]) => {
    const next = READING_WIDTHS.find((w) => w.id === id) ?? DEFAULT_WIDTH;
    setWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      // Not remembered, but still applied
    }
  }, []);

  return [width, choose];
}
