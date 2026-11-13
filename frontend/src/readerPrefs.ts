import { useCallback, useEffect, useState } from "react";
import { getItem, setItem } from "./storage";

// The opening line of review notes, in the browser; and, in the desktop app,
// that an earlier version's was moved to settings.json
const INTRO_ON_KEY = "folio.reviewIntroOn";
const INTRO_KEY = "folio.reviewIntro";
const INTRO_MOVED_KEY = "folio.reviewIntroInSettings";

/**
 * Reading preferences chosen in the header's display options menu, each
 * remembered per browser / desktop install (storage.ts). Applied as CSS
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

/** The document's built-in style (documentStyles.css); "default" adds nothing. */
export const DOC_STYLES = [
  { id: "default", label: "Default", value: "default" },
  { id: "book", label: "Book", value: "book" },
  { id: "compact", label: "Compact", value: "compact" },
] as const;

/** Where notes are shown: as icons in the margin, or in the text under their passage (docs/design/inline-notes.md). */
export const NOTE_PLACES = [
  { id: "margin", label: "In margin" },
  { id: "inline", label: "Inline" },
] as const;

export type ReadingWidth = (typeof READING_WIDTHS)[number];
export type DocStyle = (typeof DOC_STYLES)[number];
export type FontSize = (typeof FONT_SIZES)[number];
export type NotePlace = (typeof NOTE_PLACES)[number];

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
    const saved = getItem(storageKey);
    return options.find((o) => o.id === saved) ?? fallback;
  });

  const choose = useCallback(
    (id: T["id"]) => {
      const next = options.find((o) => o.id === id) ?? fallback;
      setCurrent(next);
      setItem(storageKey, next.id);
    },
    [options, storageKey, fallback],
  );

  return [current, choose];
}

/** An on / off preference remembered under `storageKey`. */
function useStoredFlag(storageKey: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    const saved = getItem(storageKey);
    return saved === null ? fallback : saved === "true";
  });
  const choose = useCallback(
    (next: boolean) => {
      setOn(next);
      setItem(storageKey, String(next));
    },
    [storageKey],
  );
  return [on, choose];
}

/** Whether the outline of headings is shown beside the document (header toggle). */
export function useOutlineVisible(): [boolean, (visible: boolean) => void] {
  return useStoredFlag("folio.outline", true);
}

/** Whether the sidebar groups documents by folder (sidebar header toggle). */
export function useGroupByFolder(): [boolean, (grouped: boolean) => void] {
  return useStoredFlag("folio.groupByFolder", true);
}

/** Whether the sidebar search also searches document text (search box toggle, ⇧⌘F). */
export function useSearchDocumentText(): [boolean, (on: boolean) => void] {
  return useStoredFlag("folio.searchDocumentText", false);
}

/**
 * The opening line of review notes (Settings): whether there is one, and its
 * wording ("" for the default; {documents} is replaced with the file name or
 * "3 documents").
 *
 * The desktop app keeps it in settings.json, where the MCP server reads it
 * too, so an agent's notes start as copied ones do. The browser (the live
 * demo) keeps it with the view preferences.
 */
export function useReviewIntro(): {
  on: boolean;
  setOn: (on: boolean) => void;
  text: string;
  setText: (text: string) => void;
} {
  const settings = window.markdownApi?.settings;
  const [on, setOnState] = useState(() => getItem(INTRO_ON_KEY) !== "false");
  const [text, setTextState] = useState(() => getItem(INTRO_KEY) ?? "");

  useEffect(() => {
    if (settings === undefined) return;
    const show = (s: { reviewIntroOn: boolean; reviewIntro: string }) => {
      setOnState(s.reviewIntroOn);
      setTextState(s.reviewIntro);
    };
    void settings.get().then((saved) => {
      // Saved by an earlier version with the view preferences: moved to settings.json once
      if (getItem(INTRO_MOVED_KEY) === null) {
        setItem(INTRO_MOVED_KEY, "1");
        const oldOn = getItem(INTRO_ON_KEY);
        const oldText = getItem(INTRO_KEY);
        if (oldOn !== null || oldText !== null) {
          void settings
            .set({ reviewIntroOn: oldOn !== "false", reviewIntro: oldText ?? "" })
            .then(show);
          return;
        }
      }
      show(saved);
    });
    return settings.onChange(show);
  }, [settings]);

  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      if (settings) void settings.set({ reviewIntroOn: next });
      else setItem(INTRO_ON_KEY, String(next));
    },
    [settings],
  );
  const setText = useCallback(
    (next: string) => {
      setTextState(next);
      if (settings) void settings.set({ reviewIntro: next });
      else setItem(INTRO_KEY, next);
    },
    [settings],
  );
  return { on, setOn, text, setText };
}

/** Don't send these notes again (the Send dialog, docs/design/sending-notes.md): on by default, remembered. */
export function useMarkSent(): [boolean, (on: boolean) => void] {
  return useStoredFlag("folio.markSent", true);
}

export function useReadingWidth(): [ReadingWidth, (id: ReadingWidth["id"]) => void] {
  return useStoredOption<ReadingWidth>(READING_WIDTHS, "folio.readingWidth", READING_WIDTHS[1]);
}

/** Where notes are shown (display options menu, ⌥⌘N). */
export function useNotePlace(): [NotePlace, (id: NotePlace["id"]) => void] {
  return useStoredOption<NotePlace>(NOTE_PLACES, "folio.notePlace", NOTE_PLACES[1]);
}

export function useDocStyle(): [DocStyle, (id: DocStyle["id"]) => void] {
  return useStoredOption<DocStyle>(DOC_STYLES, "folio.docStyle", DOC_STYLES[0]);
}

export function useFontSize(): [FontSize, (id: FontSize["id"]) => void] {
  return useStoredOption<FontSize>(FONT_SIZES, "folio.fontSize", FONT_SIZES[1]);
}
