import React from "react";

/** A git branch: two commits on a line, and one branching off. */
export function BranchIcon({ size = 14, className }: { size?: number; className?: string }): React.ReactElement {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="4.5" r="1.5" />
      <path d="M5 5v6M11 6c0 3-6 2.5-6 5" strokeLinecap="round" />
    </svg>
  );
}

/** A linked worktree: a second checkout branching off the main one. */
export function WorktreeIcon({ size = 14, className }: { size?: number; className?: string }): React.ReactElement {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="2" y="2" width="6" height="4.5" rx="1" />
      <rect x="8" y="9.5" width="6" height="4.5" rx="1" />
      <path d="M5 6.5v5.25h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
