import React from "react";
import styles from "./SidebarTabs.module.css";

export type SidebarView = "documents" | "marks";

const TABS: { view: SidebarView; label: string }[] = [
  { view: "documents", label: "Documents" },
  { view: "marks", label: "Marks" },
];

interface SidebarTabsProps {
  view: SidebarView;
  onChange: (view: SidebarView) => void;
  /** New and changed documents, shown after Documents ("Documents · 4"); none when 0. */
  unread?: number;
}

/** Documents | Marks: the switch at the top of the sidebar, in place of its title. */
export default function SidebarTabs({ view, onChange, unread = 0 }: SidebarTabsProps): React.ReactElement {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Sidebar">
      {TABS.map((tab) => (
        <button
          key={tab.view}
          type="button"
          role="tab"
          className={`${styles.tab} ${tab.view === view ? styles.tabOn : ""}`}
          aria-selected={tab.view === view}
          onClick={() => onChange(tab.view)}
          onKeyDown={(e) => {
            // ← → move between the two tabs
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = TABS.find((t) => t.view !== tab.view);
            if (next === undefined) return;
            onChange(next.view);
            (e.currentTarget.parentElement?.querySelector(`[data-view="${next.view}"]`) as HTMLElement | null)?.focus();
          }}
          data-view={tab.view}
          tabIndex={tab.view === view ? 0 : -1}
        >
          {tab.label}
          {tab.view === "documents" && unread > 0 && (
            <span className={styles.unread}>
              {" · "}
              {unread}
              <span className={styles.srOnly}> unread</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
