import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { DOC_STYLES, FONT_SIZES, NOTE_PLACES, READING_WIDTHS } from "../readerPrefs";
import type { DocStyle, FontSize, NotePlace, ReadingWidth } from "../readerPrefs";
import { THEME_OPTIONS } from "../theme";
import type { ThemePreference } from "../theme";
import styles from "./DisplayMenu.module.css";

interface DisplayMenuProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  readingWidth: ReadingWidth["id"];
  onReadingWidthChange: (id: ReadingWidth["id"]) => void;
  fontSize: FontSize["id"];
  onFontSizeChange: (id: FontSize["id"]) => void;
  docStyle: DocStyle["id"];
  onDocStyleChange: (id: DocStyle["id"]) => void;
  notePlace: NotePlace["id"];
  onNotePlaceChange: (id: NotePlace["id"]) => void;
  /** Class for the trigger button, so it matches the header's other icon buttons. */
  buttonClassName?: string | undefined;
}

/**
 * Header dropdown for display preferences: appearance (System / Light /
 * Dark), document style, reading width, font size and where notes are
 * shown. Follows the WAI-ARIA menu button pattern: arrow
 * keys move between options, Enter/Space picks one, Escape closes.
 */
export default function DisplayMenu({
  theme,
  onThemeChange,
  readingWidth,
  onReadingWidthChange,
  fontSize,
  onFontSizeChange,
  docStyle,
  onDocStyleChange,
  notePlace,
  onNotePlaceChange,
  buttonClassName,
}: DisplayMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = useCallback(
    () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])],
    [],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // On open, focus the checked option of the first group
  useEffect(() => {
    if (!open) return;
    const all = items();
    (all.find((el) => el.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
  }, [open, items]);

  // Clicking anywhere else closes the menu
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = all[(index + 1) % all.length];
        break;
      case "ArrowUp":
        next = all[(index - 1 + all.length) % all.length];
        break;
      case "Home":
        next = all[0];
        break;
      case "End":
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function option<T extends string>(id: T, label: string, checked: boolean, onPick: (id: T) => void) {
    return (
      <button
        key={id}
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        tabIndex={-1}
        className={styles.item}
        onClick={() => {
          onPick(id);
          close(true);
        }}
      >
        <span className={styles.check} aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
        {label}
      </button>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label="Display options"
        title="Display options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
      >
        {/* Half-filled circle: light / dark */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" />
          <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div id={menuId} ref={menuRef} role="menu" aria-label="Display options" className={styles.menu} onKeyDown={onMenuKeyDown}>
          <div role="group" aria-labelledby={`${menuId}-appearance`}>
            <div id={`${menuId}-appearance`} className={styles.heading}>
              Appearance
            </div>
            {THEME_OPTIONS.map((o) => option(o.id, o.label, o.id === theme, onThemeChange))}
          </div>
          <div role="separator" className={styles.separator} />
          <div role="group" aria-labelledby={`${menuId}-style`}>
            <div id={`${menuId}-style`} className={styles.heading}>
              Style
            </div>
            {DOC_STYLES.map((d) => option(d.id, d.label, d.id === docStyle, onDocStyleChange))}
          </div>
          <div role="separator" className={styles.separator} />
          <div role="group" aria-labelledby={`${menuId}-width`}>
            <div id={`${menuId}-width`} className={styles.heading}>
              Reading width
            </div>
            {READING_WIDTHS.map((w) => option(w.id, w.label, w.id === readingWidth, onReadingWidthChange))}
          </div>
          <div role="separator" className={styles.separator} />
          <div role="group" aria-labelledby={`${menuId}-font`}>
            <div id={`${menuId}-font`} className={styles.heading}>
              Font size
            </div>
            {FONT_SIZES.map((f) => option(f.id, f.label, f.id === fontSize, onFontSizeChange))}
          </div>
          <div role="separator" className={styles.separator} />
          <div role="group" aria-labelledby={`${menuId}-notes`}>
            <div id={`${menuId}-notes`} className={styles.heading}>
              Notes
            </div>
            {NOTE_PLACES.map((n) => option(n.id, n.label, n.id === notePlace, onNotePlaceChange))}
          </div>
        </div>
      )}
    </div>
  );
}
