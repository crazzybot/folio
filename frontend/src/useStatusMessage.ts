/**
 * useStatusMessage.ts — The status bar's message (e.g. "Copied 4 notes"),
 * cleared after a few seconds.
 */

import { useEffect, useState } from "react";

// How long a status-bar message shows
const STATUS_SHOWN_MS = 4000;
// A message with an action (Undo) stays longer
const UNDO_SHOWN_MS = 8000;

/** A message in the status bar, with an optional action (Undo). */
export interface StatusMessage {
  text: string;
  action?: { label: string; run: () => void };
}

export function useStatusMessage(): [StatusMessage | null, (message: StatusMessage | null) => void] {
  const [message, setMessage] = useState<StatusMessage | null>(null);
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), message.action ? UNDO_SHOWN_MS : STATUS_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message]);
  return [message, setMessage];
}
