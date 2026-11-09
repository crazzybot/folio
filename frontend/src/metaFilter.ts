/**
 * metaFilter.ts — Filtering the document list by status and tags
 * (docs/design/frontmatter-metadata.md). Applied right after Focus on
 * Folder, so the list, search, the Marks view and the status bar count all
 * follow it.
 *
 * Remembered per workspace by useMetaFilters.ts.
 */

import { KNOWN_STATUSES } from "./status";
import type { DocumentMeta } from "./types";

export interface MetaFilters {
  statuses: readonly string[];
  tags: readonly string[];
}

export const NO_FILTERS: MetaFilters = { statuses: [], tags: [] };

export function hasFilters(filters: MetaFilters): boolean {
  return filters.statuses.length > 0 || filters.tags.length > 0;
}

/** Documents with any of the statuses (if any are chosen) and any of the tags (if any are chosen). */
export function filterByMeta(documents: DocumentMeta[], filters: MetaFilters): DocumentMeta[] {
  if (!hasFilters(filters)) return documents;
  const statuses = new Set(filters.statuses);
  const tags = new Set(filters.tags);
  return documents.filter(
    (doc) =>
      (statuses.size === 0 || (doc.meta?.status != null && statuses.has(doc.meta.status))) &&
      (tags.size === 0 || (doc.meta?.tags ?? []).some((tag) => tags.has(tag))),
  );
}

export interface FilterOption {
  value: string;
  /** Documents with it, among those the options were counted in. */
  count: number;
}

/**
 * What the filter menu offers for `documents` (the focused folder's): each
 * status and tag with its count. Statuses in MADR's order, then others A–Z;
 * tags most used first. Chosen values are offered even with no documents, so
 * they can be unchecked.
 */
export function filterOptions(
  documents: readonly DocumentMeta[],
  chosen: MetaFilters = NO_FILTERS,
): { statuses: FilterOption[]; tags: FilterOption[] } {
  const statuses = new Map<string, number>(chosen.statuses.map((s) => [s, 0]));
  const tags = new Map<string, number>(chosen.tags.map((t) => [t, 0]));
  for (const doc of documents) {
    const status = doc.meta?.status;
    if (status != null) statuses.set(status, (statuses.get(status) ?? 0) + 1);
    for (const tag of doc.meta?.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const known = KNOWN_STATUSES as readonly string[];
  const rank = (s: string) => (known.includes(s) ? known.indexOf(s) : known.length);
  const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return {
    statuses: [...statuses]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => rank(a.value) - rank(b.value) || byName.compare(a.value, b.value)),
    tags: [...tags]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || byName.compare(a.value, b.value)),
  };
}

/** `filters` with `value` added to (or, when there, removed from) its list. */
export function toggleFilter(filters: MetaFilters, kind: "status" | "tag", value: string): MetaFilters {
  const key = kind === "status" ? "statuses" : "tags";
  const list = filters[key];
  return { ...filters, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
}

// ── Remembered per workspace ──────────────────────────────────────────────────

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

/** Saved filters per workspace; unreadable or malformed storage counts as none. */
export function parseSavedFilters(raw: string | null): Map<string, MetaFilters> {
  try {
    const saved: unknown = JSON.parse(raw ?? "{}");
    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return new Map();
    const map = new Map<string, MetaFilters>();
    for (const [workspace, value] of Object.entries(saved as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const { statuses, tags } = value as Record<string, unknown>;
      const filters = { statuses: strings(statuses), tags: strings(tags) };
      if (hasFilters(filters)) map.set(workspace, filters);
    }
    return map;
  } catch {
    return new Map();
  }
}
