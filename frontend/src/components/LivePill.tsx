import React from "react";
import { agentsSentence } from "../agents";
import type { AgentSession } from "../types";
import styles from "./LivePill.module.css";

/**
 * "Live": an agent is in a review loop here, so notes sent from these
 * documents go straight to it. The dot pulses while it waits; it's still
 * while the agent works on the last notes. With `onClick`, a button (the
 * status bar's, whose menu ends the loop).
 */
export default function LivePill({
  agents,
  onClick,
}: {
  agents: readonly AgentSession[];
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}): React.ReactElement | null {
  if (agents.length === 0) return null;
  const sentence = agentsSentence(agents);
  const content = (
    <>
      <span className={`${styles.dot} ${agents.some((a) => a.state === "waiting") ? styles.waiting : ""}`} aria-hidden="true" />
      Live
    </>
  );
  return onClick === undefined ? (
    <span className={styles.pill} role="img" aria-label={`Live: ${sentence}`} title={sentence}>
      {content}
    </span>
  ) : (
    <button type="button" className={`${styles.pill} ${styles.button}`} onClick={onClick} aria-label={`Live: ${sentence}`} title={sentence}>
      {content}
    </button>
  );
}
