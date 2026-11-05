import React, { useLayoutEffect, useRef, useState } from "react";
import MarkdownIcon from "./MarkdownIcon";
import styles from "./Breadcrumb.module.css";

interface BreadcrumbProps {
  /** Relative document path, e.g. "samples/code-demo.md", or null for none. */
  location: string | null;
}

/**
 * Folder › folder › file path, as in the VS Code editor header.
 *
 * When the path is wider than the header, the leading folders collapse into
 * a single "…" (its tooltip shows them) so the folders nearest the document
 * and the filename stay readable. Item widths come from an invisible copy
 * of the full path, re-measured on resize.
 */
export default function Breadcrumb({ location }: BreadcrumbProps): React.ReactElement {
  const parts = location !== null ? location.split("/") : [];
  const filename = parts[parts.length - 1] ?? "";
  const folders = parts.slice(0, -1);

  const containerRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    function fit() {
      if (!container || !measure) return;
      // Measure row children: [ellipsis, ...folders, file]
      const widths = Array.from(measure.children, (el) => (el as HTMLElement).offsetWidth);
      const ellipsisWidth = widths[0] ?? 0;
      const folderWidths = widths.slice(1, -1);
      const fileWidth = widths[widths.length - 1] ?? 0;

      let total = fileWidth + folderWidths.reduce((sum, w) => sum + w, 0);
      let hidden = 0;
      while (hidden < folderWidths.length && total > container.clientWidth) {
        if (hidden === 0) total += ellipsisWidth;
        total -= folderWidths[hidden] ?? 0;
        hidden++;
      }
      setHiddenCount(hidden);
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [location]);

  const hiddenFolders = folders.slice(0, hiddenCount);
  const visibleFolders = folders.slice(hiddenCount);

  return (
    <nav className={styles.breadcrumb} ref={containerRef} aria-label="Document path">
      {location !== null && (
        <>
          {/* Invisible full-width copy used only for measuring */}
          <div className={styles.measure} ref={measureRef} aria-hidden="true">
            <FolderItem name="…" />
            {folders.map((name, i) => (
              <FolderItem key={i} name={name} />
            ))}
            <FileItem name={filename} />
          </div>

          {hiddenFolders.length > 0 && (
            <FolderItem name="…" title={hiddenFolders.join("/")} />
          )}
          {visibleFolders.map((name, i) => (
            <FolderItem key={hiddenCount + i} name={name} />
          ))}
          <FileItem name={filename} title={location} />
        </>
      )}
    </nav>
  );
}

// ─── Items ────────────────────────────────────────────────────────────────────

function FolderItem({ name, title }: { name: string; title?: string }): React.ReactElement {
  return (
    <span className={styles.item} title={title}>
      <span className={styles.folder}>{name}</span>
      <svg className={styles.separator} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
    </span>
  );
}

function FileItem({ name, title }: { name: string; title?: string }): React.ReactElement {
  return (
    <span className={`${styles.item} ${styles.fileItem}`} title={title}>
      <MarkdownIcon className={styles.icon} />
      <span className={styles.file}>{name}</span>
    </span>
  );
}
