import React from "react";
import { statusText, supersedingDocument } from "../status";
import type { DocumentMeta } from "../types";
import StatusIcon from "./StatusIcon";
import styles from "./DocumentProperties.module.css";

interface DocumentPropertiesProps {
  doc: DocumentMeta;
  documents: readonly DocumentMeta[];
  onOpenDocument?: ((id: string, anchor: string | null) => void) | undefined;
}

/**
 * The document's metadata (front matter, or its status line) above its
 * text: status, date and decision makers, then tags. Outside the article,
 * so highlights' text positions don't count it.
 */
export default function DocumentProperties({ doc, documents, onOpenDocument }: DocumentPropertiesProps): React.ReactElement | null {
  const meta = doc.meta;
  if (meta === undefined) return null;
  const { status, date, people, tags } = meta;
  const successor = onOpenDocument === undefined ? null : supersedingDocument(doc, documents);
  const described = [date, people.length > 0 ? people.join(", ") : null].filter((part): part is string => part !== null);

  return (
    <div className={styles.properties} aria-label="Document properties" role="group">
      {status !== null && (
        <span className={styles.status}>
          <StatusIcon status={status} className={styles.statusIcon} />
          {successor !== null ? (
            <button type="button" className={styles.link} onClick={() => onOpenDocument?.(successor.id, null)} title={successor.location}>
              {statusText(meta)}
            </button>
          ) : (
            statusText(meta)
          )}
        </span>
      )}
      {described.map((part) => (
        <span key={part} className={styles.detail}>
          {part}
        </span>
      ))}
      {tags.length > 0 && (
        <span className={styles.tags}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              #{tag}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
