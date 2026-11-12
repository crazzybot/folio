import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./FilterMenu.module.css";

// Past this many options, a section gets a box to narrow them
const SEARCH_FROM = 10;
const MENU_WIDTH = 240;
const WINDOW_MARGIN = 8;

/** An option to pick: its label (and icon), how many it would show, and whether it's picked. */
export interface MenuOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count: number;
  checked: boolean;
}

/** A group of options under a heading ("Status", "Tags", "State"). */
export interface MenuSection {
  id: string;
  heading: string;
  options: readonly MenuOption[];
  /** With many options, the box that narrows them: its placeholder, e.g. "Filter tags…". */
  searchPlaceholder?: string;
}

interface FilterMenuProps {
  sections: readonly MenuSection[];
  /** How many options are picked: the button's badge. */
  active: number;
  onToggle: (sectionId: string, value: string) => void;
  /** Clear filters: back to no options picked. */
  onClear: () => void;
  /** What the button and menu are called, e.g. "Filter by status and tags". */
  label: string;
  /** A line under the options, e.g. what's hidden while none is picked. */
  note?: string | undefined;
  /** Class for the trigger button, so it matches the buttons beside it. */
  buttonClassName: string | undefined;
  /** Added to the trigger while filters are on. */
  activeClassName: string | undefined;
  badgeClassName: string | undefined;
}

/**
 * A filter button and its menu: sections of options with their counts, as
 * checkable items (the menu stays open to pick several). Nothing picked
 * shows everything; picking narrows. Used by the document list (statuses
 * and tags) and the Marks view (note states). WAI-ARIA menu button
 * pattern, as DisplayMenu. In a portal: the sidebar clips what overflows it.
 */
export default function FilterMenu({
  sections,
  active,
  onToggle,
  onClear,
  label,
  note,
  buttonClassName,
  activeClassName,
  badgeClassName,
}: FilterMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [queries, setQueries] = useState<Readonly<Record<string, string>>>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = useCallback(
    () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"], input') ?? [])],
    [],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setQueries({});
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

  function item(sectionId: string, option: MenuOption) {
    return (
      <button
        key={option.value}
        type="button"
        role="menuitemcheckbox"
        aria-checked={option.checked}
        tabIndex={-1}
        className={styles.item}
        onClick={() => onToggle(sectionId, option.value)}
      >
        <span className={styles.check} aria-hidden="true">
          {option.checked ? "✓" : ""}
        </span>
        {option.icon !== undefined && (
          <span className={styles.icon} aria-hidden="true">
            {option.icon}
          </span>
        )}
        <span className={styles.label}>{option.label}</span>
        <span className={styles.count}>{option.count}</span>
      </button>
    );
  }

  const shown = sections.filter((section) => section.options.length > 0);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClassName ?? ""} ${active > 0 ? (activeClassName ?? "") : ""}`}
        aria-label={active > 0 ? `${label} (${active} on)` : label}
        title={label}
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
            aria-label={label}
            className={styles.menu}
            style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
            onKeyDown={onMenuKeyDown}
          >
            {shown.map((section, i) => {
              const searchable = section.searchPlaceholder !== undefined && section.options.length > SEARCH_FROM;
              const q = (queries[section.id] ?? "").trim().toLowerCase().replace(/^#/, "");
              const options = q === "" ? section.options : section.options.filter((o) => o.value.toLowerCase().includes(q));
              return (
                <React.Fragment key={section.id}>
                  {i > 0 && <div role="separator" className={styles.separator} />}
                  <div role="group" aria-labelledby={`${menuId}-${section.id}`}>
                    <div id={`${menuId}-${section.id}`} className={styles.heading}>
                      {section.heading}
                    </div>
                    {searchable && (
                      <input
                        type="search"
                        className={styles.search}
                        placeholder={section.searchPlaceholder}
                        aria-label={section.searchPlaceholder?.replace(/…$/, "")}
                        value={queries[section.id] ?? ""}
                        onChange={(e) => setQueries((prev) => ({ ...prev, [section.id]: e.target.value }))}
                      />
                    )}
                    <div className={searchable ? styles.scroll : undefined}>
                      {options.map((option) => item(section.id, option))}
                      {options.length === 0 && <div className={styles.none}>None match</div>}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            {note !== undefined && <div className={styles.note}>{note}</div>}
            {active > 0 && (
              <>
                <div role="separator" className={styles.separator} />
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={styles.item}
                  onClick={() => {
                    onClear();
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
