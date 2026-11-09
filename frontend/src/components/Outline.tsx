import React, { useEffect, useRef } from "react";
import { useDrawerFocus } from "../drawer";
import DrawerCloseButton from "./DrawerCloseButton";
import { BookmarkIcon } from "./MarksLayer";
import styles from "./Outline.module.css";

export interface OutlineHeading {
  /** The heading element's id (its anchor). */
  id: string;
  text: string;
  level: number; // 1-6
}

interface OutlineProps {
  headings: OutlineHeading[];
  /** The heading of the section being read, highlighted. */
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Highlights in each heading's section, by position in `headings`. */
  highlightCounts?: readonly number[];
  /** Whether each heading is bookmarked, by position in `headings`. */
  bookmarked?: readonly boolean[];
  /** In a narrow window: a drawer over the document, shown while open. */
  drawer?: { open: boolean; onClose: () => void };
}

/**
 * The open document's headings, indented by level, with the section being
 * read highlighted — like VS Code's Outline view.
 */
export default function Outline({
  headings,
  activeId,
  onSelect,
  highlightCounts = [],
  bookmarked = [],
  drawer,
}: OutlineProps): React.ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useDrawerFocus(drawer?.open === true, navRef);
  // Indent relative to the shallowest heading, so a document without an h1 isn't pushed right
  const minLevel = headings.reduce((min, h) => Math.min(min, h.level), 6);

  // Keep the active entry in view as the document scrolls: once it would
  // leave the list, centre it, so the sections around it show too
  useEffect(() => {
    const list = listRef.current;
    if (activeId === null || list === null) return;
    const item = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`);
    if (item === null) return;
    const listBox = list.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const margin = itemBox.height * 2;
    if (itemBox.top < listBox.top + margin || itemBox.bottom > listBox.bottom - margin) {
      list.scrollTop += itemBox.top - listBox.top - (list.clientHeight - itemBox.height) / 2;
    }
  }, [activeId]);

  return (
    <nav
      ref={navRef}
      className={
        drawer === undefined ? styles.outline : `${styles.outline} ${styles.drawer} ${drawer.open ? styles.drawerOpen : ""}`
      }
      aria-label="Outline"
      inert={drawer !== undefined && !drawer.open}
      tabIndex={drawer === undefined ? undefined : -1}
    >
      {drawer === undefined ? (
        <h2 className={styles.heading}>Outline</h2>
      ) : (
        <div className={styles.drawerHeader}>
          <h2 className={styles.heading}>Outline</h2>
          <DrawerCloseButton direction="right" label="Hide outline" onClick={drawer.onClose} />
        </div>
      )}
      {headings.length === 0 ? (
        <p className={styles.empty}>No headings in this document.</p>
      ) : (
        <ul className={styles.list} ref={listRef}>
          {headings.map((h, i) => {
            const count = highlightCounts[i] ?? 0;
            const marks = [
              ...(bookmarked[i] === true ? ["bookmarked"] : []),
              ...(count > 0 ? [`${count} ${count === 1 ? "highlight" : "highlights"}`] : []),
            ];
            return (
              <li key={`${h.id}-${i}`}>
                <button
                  type="button"
                  data-id={h.id}
                  className={`${styles.item} ${h.id === activeId ? styles.active : ""}`}
                  style={{ paddingLeft: `${12 + (h.level - minLevel) * 12}px` }}
                  aria-current={h.id === activeId ? "location" : undefined}
                  title={h.text}
                  aria-label={marks.length > 0 ? `${h.text}, ${marks.join(", ")}` : undefined}
                  onClick={() => onSelect(h.id)}
                >
                  <span className={styles.itemText}>{h.text}</span>
                  {bookmarked[i] === true && (
                    <span className={styles.bookmark} aria-hidden="true">
                      <BookmarkIcon filled />
                    </span>
                  )}
                  {count > 0 && (
                    <span className={styles.marks} aria-hidden="true">
                      {count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
