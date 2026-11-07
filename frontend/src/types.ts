/** A section heading, as rendered (no markdown syntax). */
export interface Heading {
  level: number; // 1-6
  text: string;
}

export interface DocumentMeta {
  id: string;
  filename: string;
  location: string; // relative path from workspace root
  title: string;
  created: string; // ISO-8601
  headings: Heading[];
}

export interface DocumentContent {
  id: string;
  content: string;
}

/** A matching line in a document (GET /api/search). */
export interface SearchMatch {
  /** 1-based line number. */
  line: number;
  /** The line, shortened around the match when long. */
  text: string;
  /** The match within `text`: [start, end). */
  start: number;
  end: number;
  /** 0-based index of this match among the document's matches. */
  occurrence: number;
}

export interface SearchResult {
  id: string;
  matchCount: number;
  /** The first few matches. */
  matches: SearchMatch[];
}

export type PanelSide = "left" | "right";

/** Whether the desktop window's history has entries behind / ahead of the current one. */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

// ─── Marks (GET /api/marks, /api/documents/{id}/highlights) ────────────────

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Where a highlight is in the document's rendered text (see anchoring.ts). */
export interface TextAnchor {
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
}

export interface Highlight extends TextAnchor {
  id: string;
  color: HighlightColor;
  note: string | null;
  created: string; // ISO-8601
  updated: string;
}

/** A document that has marks. */
export interface DocumentMarks {
  docId: string;
  location: string;
  highlights: Highlight[];
}

export interface MarksListing {
  documents: DocumentMarks[];
}
