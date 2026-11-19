import React from "react";
import { changeCount } from "../../../packages/core/src/sections";
import type { SectionChanges } from "../../../packages/core/src/sections";
import type { Heading } from "../types";
import styles from "./ChangesBanner.module.css";

// Sections named in the banner before "and N more"
const MAX_NAMED = 5;

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export interface ChangesBannerProps {
  /** When the version compared with was read. */
  readAt: string;
  /** That version was recorded when Folio first saw the workspace, not read. */
  baseline: boolean;
  /** What changed since, section by section; null without a snapshot of the version read. */
  changes: SectionChanges | null;
  /** Still unread: offer Mark as Read (else the banner only closes). */
  unread: boolean;
  onOpenSection: (heading: Heading) => void;
  onMarkRead: () => void;
  onClose: () => void;
}

export interface ChangedSection {
  heading: Heading;
  kind: "changed" | "added" | "removed";
}

/** The sections that changed, were added or removed, then "the front matter" and "the opening" when those changed. */
export function changedParts(changes: SectionChanges | null): { named: ChangedSection[]; others: string[] } {
  const named: ChangedSection[] =
    changes === null
      ? []
      : [
          ...changes.changed.map((heading) => ({ heading, kind: "changed" as const })),
          ...changes.added.map((heading) => ({ heading, kind: "added" as const })),
          ...changes.removed.map((heading) => ({ heading, kind: "removed" as const })),
        ];
  const others = [changes?.frontMatter === true && "the front matter", changes?.intro === true && "the opening"].filter(
    (part): part is string => typeof part === "string",
  );
  return { named, others };
}

/**
 * In the document's header, when it changed since it was read: since when,
 * and which sections changed (each one a link to it). Stays while the
 * document is open, even once it counts as read, so it doesn't vanish
 * mid-read.
 */
export default function ChangesBanner({
  readAt,
  baseline,
  changes,
  unread,
  onOpenSection,
  onMarkRead,
  onClose,
}: ChangesBannerProps): React.ReactElement {
  const since = `${baseline ? "Changed since Folio first saw it" : "Changed since you read it"} on ${DATE.format(new Date(readAt))}`;
  const count = changes === null ? null : changeCount(changes);
  const { named, others } = changedParts(changes);
  const more = named.length - MAX_NAMED;

  return (
    <div className={styles.banner} role="region" aria-label="Changes since you read it">
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.body}>
        <span className={styles.since}>
          {since}
          {count !== null && (count === 0 ? " · only spacing" : ` · ${count} ${count === 1 ? "section" : "sections"}`)}
        </span>
        {(named.length > 0 || others.length > 0) && (
          <span className={styles.sections}>
            {named.slice(0, MAX_NAMED).map(({ heading, kind }, i) => (
              <React.Fragment key={`${kind}:${heading.level}:${heading.text}:${i}`}>
                {i > 0 && ", "}
                {kind === "removed" ? (
                  <span className={styles.removed} title="Removed">
                    {heading.text}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.section}
                    onClick={() => onOpenSection(heading)}
                    title={kind === "added" ? "New section" : "Go to this section"}
                  >
                    {heading.text}
                    {kind === "added" && <span className={styles.addedMark}> (new)</span>}
                  </button>
                )}
              </React.Fragment>
            ))}
            {more > 0 && ` and ${more} more`}
            {others.length > 0 && `${named.length > 0 ? ", " : ""}${others.join(" and ")}`}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        {unread && (
          <button type="button" className={styles.action} onClick={onMarkRead}>
            Mark as Read
          </button>
        )}
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close" title="Close">
          ×
        </button>
      </div>
    </div>
  );
}
