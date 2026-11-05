import React, { useEffect, useRef } from "react";
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
}

/**
 * The open document's headings, indented by level, with the section being
 * read highlighted — like VS Code's Outline view.
 */
export default function Outline({ headings, activeId, onSelect }: OutlineProps): React.ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
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
    <nav className={styles.outline} aria-label="Outline">
      <h2 className={styles.heading}>Outline</h2>
      {headings.length === 0 ? (
        <p className={styles.empty}>No headings in this document.</p>
      ) : (
        <ul className={styles.list} ref={listRef}>
          {headings.map((h, i) => (
            <li key={`${h.id}-${i}`}>
              <button
                type="button"
                data-id={h.id}
                className={`${styles.item} ${h.id === activeId ? styles.active : ""}`}
                style={{ paddingLeft: `${12 + (h.level - minLevel) * 12}px` }}
                aria-current={h.id === activeId ? "location" : undefined}
                title={h.text}
                onClick={() => onSelect(h.id)}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
