import React, { useId } from "react";
import { statusKind } from "../status";
import type { StatusKind } from "../status";

// Colour says where the decision stands; retired and paused documents use text colours
const COLORS: Record<StatusKind, string> = {
  draft: "var(--color-text-muted)",
  proposed: "var(--color-status-proposed)",
  accepted: "var(--color-status-accepted)",
  "in-progress": "var(--color-status-accepted)",
  implemented: "var(--color-status-accepted)",
  deferred: "var(--color-text-muted)",
  rejected: "var(--color-text-subtle)",
  deprecated: "var(--color-text-subtle)",
  superseded: "var(--color-text-subtle)",
  other: "var(--color-text-muted)",
};

const CHECK = "M5.2 8.3l1.9 1.9 3.8-4";

// What's inside the circle: shape tells the statuses apart, not only colour.
// Along the accepted path the fill shows progress: check, half, full.
const MARKS: Record<Exclude<StatusKind, "implemented">, React.ReactNode> = {
  draft: null,
  proposed: <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />,
  accepted: <path d={CHECK} />,
  "in-progress": <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" />,
  deferred: <path d="M6.5 5.6v4.8M9.5 5.6v4.8" />,
  rejected: <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />,
  deprecated: <path d="M5.2 8h5.6" />,
  superseded: <path d="M5.2 10.2a3 3 0 0 1 5.2-3M10.8 4.8v2.6H8.2" />,
  other: null,
};

/** A document status as a 16px glyph: shape and colour per status; the text beside it says which. */
export default function StatusIcon({ status, className }: { status: string; className?: string | undefined }): React.ReactElement {
  const kind = statusKind(status);
  const maskId = useId();
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: COLORS[kind] }}
      aria-hidden="true"
      focusable="false"
    >
      {kind === "implemented" ? (
        // A solid disc with the check cut out, so it reads on any row background
        <>
          <mask id={maskId}>
            <rect width="16" height="16" fill="white" />
            <path d={CHECK} stroke="black" strokeWidth="1.6" />
          </mask>
          <circle cx="8" cy="8" r="7.15" fill="currentColor" stroke="none" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          {/* A draft's ring is dashed: not yet a proposal */}
          <circle cx="8" cy="8" r="6.5" strokeDasharray={kind === "draft" ? "2.4 2.7" : undefined} />
          {MARKS[kind]}
        </>
      )}
    </svg>
  );
}
