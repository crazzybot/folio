/**
 * useMetaFilters.ts — The status and tag filters (metaFilter.ts), remembered
 * per workspace (storage.ts) as folder focus is.
 */

import { useCallback, useState } from "react";
import { hasFilters, NO_FILTERS, parseSavedFilters } from "./metaFilter";
import type { MetaFilters } from "./metaFilter";
import { getItem, setItem } from "./storage";

const FILTERS_KEY = "folio.metaFilters";
// Workspaces remembered, most recent last
const MAX_REMEMBERED_WORKSPACES = 50;

function saveFilters(workspace: string, filters: MetaFilters): void {
  const map = parseSavedFilters(getItem(FILTERS_KEY));
  // Re-adding moves it to the end: the most recently used survive the cap
  map.delete(workspace);
  if (hasFilters(filters)) map.set(workspace, filters);
  setItem(FILTERS_KEY, JSON.stringify(Object.fromEntries([...map].slice(-MAX_REMEMBERED_WORKSPACES))));
}

/** The workspace filters are remembered for: its folder in the desktop app, "" in the browser. */
function workspaceKey(): string {
  return window.markdownApi?.workspacePath ?? "";
}

/** The status and tag filters, and their setter. */
export function useMetaFilters(): [MetaFilters, (filters: MetaFilters) => void] {
  const [filters, setFilters] = useState<MetaFilters>(
    () => parseSavedFilters(getItem(FILTERS_KEY)).get(workspaceKey()) ?? NO_FILTERS,
  );
  const choose = useCallback((next: MetaFilters) => {
    setFilters(next);
    saveFilters(workspaceKey(), next);
  }, []);
  return [filters, choose];
}
