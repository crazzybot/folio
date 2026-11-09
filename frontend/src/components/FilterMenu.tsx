import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasFilters, NO_FILTERS, toggleFilter } from "../metaFilter";
import type { FilterOption, MetaFilters } from "../metaFilter";
import StatusIcon from "./StatusIcon";
import styles from "./FilterMenu.module.css";

// Past this many tags, the menu gets a box to narrow them
const TAG_SEARCH_FROM = 10;
const MENU_WIDTH = 240;
const WINDOW_MARGIN = 8;

interface FilterMenuProps {
  filters: MetaFilters;
  options: { statuses: FilterOption[]; tags: FilterOption[] };
  onChange: (filters: MetaFilters) => void;
  /** Class for the trigger button, so it matches the header's other buttons. */
  buttonClassName: string | undefined;
  /** Added to the trigger while filters are on. */
  activeClassName: string | undefined;
  badgeClassName: string | undefined;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The document list's filter button and menu: statuses and tags with their
 * counts, as checkboxes (the menu stays open to pick several). WAI-ARIA menu
 * button pattern, as DisplayMenu. In a portal: the sidebar clips what
 * overflows it.
 */
export default function FilterMenu({
  filters,
  options,
  onChange,
  buttonClassName,
  activeClassName,
  badgeClassName,
}: FilterMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const active = filters.statuses.length + filters.tags.length;

  const items = useCallback(
    () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"], input') ?? [])],
    [],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setTagQuery("");
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const toggleOpen = () => {
    if (open) {
      close(false);
      return;
    }
    const box = buttonRef.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPosition({
      left: Math.max(WINDOW_MARGIN, Math.min(box.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - WINDOW_MARGIN)),
      top: box.bottom + 4,
    });
    setOpen(true);
  };

  // On open, focus the first option
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, items]);

  // Clicking anywhere else, scrolling the page or resizing closes the menu
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    }
    const onResize = () => close(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const inSearch = document.activeElement instanceof HTMLInputElement;
    let next: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = all[(index + 1) % all.length];
        break;
      case "ArrowUp":
        next = all[(index - 1 + all.length) % all.length];
        break;
      case "Home":
        if (inSearch) return;
        next = all[0];
        break;
      case "End":
        if (inSearch) return;
        next = all[all.length - 1];
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        return;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    next?.focus();
  }

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      toggleOpen();
    }
  }

  function item(kind: "status" | "tag", option: FilterOption) {
    const checked = (kind === "status" ? filters.statuses : filters.tags).includes(option.value);
    return (
      <button
        key={option.value}
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        tabIndex={-1}
        className={styles.item}
        onClick={() => onChange(toggleFilter(filters, kind, option.value))}
      >
        <span className={styles.check} aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
        {kind === "status" ? (
          <>
            <StatusIcon status={option.value} className={styles.icon} />
            <span className={styles.label}>{capitalise(option.value)}</span>
          </>
        ) : (
          <span className={styles.label}>#{option.value}</span>
        )}
        <span className={styles.count}>{option.count}</span>
      </button>
    );
  }

  const q = tagQuery.trim().toLowerCase().replace(/^#/, "");
  const shownTags = q === "" ? options.tags : options.tags.filter((t) => t.value.includes(q));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClassName ?? ""} ${active > 0 ? (activeClassName ?? "") : ""}`}
        aria-label={active > 0 ? `Filter by status and tags (${active} on)` : "Filter by status and tags"}
        title="Filter by status and tags"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleOpen}
        onKeyDown={onButtonKeyDown}
      >
        {/* A funnel */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3h12L9.5 8.5V13l-3-1.5v-3z" />
        </svg>
        {active > 0 && (
          <span className={badgeClassName} aria-hidden="true">
            {active}
          </span>
        )}
      </button>

      {open &&
        position !== null &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label="Filter by status and tags"
            className={styles.menu}
            style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
            onKeyDown={onMenuKeyDown}
          >
            {options.statuses.length > 0 && (
              <div role="group" aria-labelledby={`${menuId}-status`}>
                <div id={`${menuId}-status`} className={styles.heading}>
                  Status
                </div>
                {options.statuses.map((option) => item("status", option))}
              </div>
            )}
            {options.statuses.length > 0 && options.tags.length > 0 && <div role="separator" className={styles.separator} />}
            {options.tags.length > 0 && (
              <div role="group" aria-labelledby={`${menuId}-tags`}>
                <div id={`${menuId}-tags`} className={styles.heading}>
                  Tags
                </div>
                {options.tags.length > TAG_SEARCH_FROM && (
                  <input
                    type="search"
                    className={styles.search}
                    placeholder="Filter tags…"
                    aria-label="Filter tags"
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                  />
                )}
                <div className={styles.scroll}>
                  {shownTags.map((option) => item("tag", option))}
                  {shownTags.length === 0 && <div className={styles.none}>No tags match</div>}
                </div>
              </div>
            )}
            {hasFilters(filters) && (
              <>
                <div role="separator" className={styles.separator} />
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={styles.item}
                  onClick={() => {
                    onChange(NO_FILTERS);
                    close(true);
                  }}
                >
                  <span className={styles.check} aria-hidden="true" />
                  Clear filters
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
