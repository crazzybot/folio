import React from "react";
import { statusKind } from "../status";
import type { StatusKind } from "../status";

const COLORS: Record<StatusKind, string> = {
  proposed: "var(--color-status-proposed)",
  accepted: "var(--color-status-accepted)",
  rejected: "var(--color-text-subtle)",
  deprecated: "var(--color-text-subtle)",
  superseded: "var(--color-text-subtle)",
  other: "var(--color-text-muted)",
};

// What's inside the circle: shape tells the statuses apart, not only colour
const MARKS: Record<StatusKind, React.ReactNode> = {
  proposed: <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" />,
  accepted: <path d="M5.2 8.3l1.9 1.9 3.8-4" />,
  rejected: <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />,
  deprecated: <path d="M5.2 8h5.6" />,
  superseded: <path d="M5.2 10.2a3 3 0 0 1 5.2-3M10.8 4.8v2.6H8.2" />,
  other: null,
};

/** A document status as a 16px glyph: shape and colour per status; the text beside it says which. */
export default function StatusIcon({ status, className }: { status: string; className?: string | undefined }): React.ReactElement {
  const kind = statusKind(status);
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
      <circle cx="8" cy="8" r="6.5" />
      {MARKS[kind]}
    </svg>
  );
}
