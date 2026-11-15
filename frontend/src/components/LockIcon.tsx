/** Only me's lock: closed and filled when the note is kept to the user. */
export default function LockIcon({ locked }: { locked: boolean }): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill={locked ? "currentColor" : "none"} />
      <path d={locked ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.8-1"} />
    </svg>
  );
}
