import React from "react";
import { normaliseStatus } from "../status";
import StatusIcon from "./StatusIcon";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A document note's requested status: "→ Accepted" while the document has
 * another status, "✓ Now accepted" once it has that one.
 */
export default function NoteRequest({
  requested,
  done,
  className,
  iconClassName,
}: {
  requested: string;
  done: boolean;
  className?: string | undefined;
  iconClassName?: string | undefined;
}): React.ReactElement {
  const status = normaliseStatus(requested);
  return (
    <span className={className}>
      {done ? "✓ Now " : "→ "}
      <StatusIcon status={status} className={iconClassName} />
      {done ? status : capitalise(requested.trim())}
    </span>
  );
}

/** As NoteRequest, for aria-labels and plain text. */
export function noteRequestText(requested: string, done: boolean): string {
  return done ? `status is now ${normaliseStatus(requested)}` : `change the status to ${requested.trim()}`;
}
