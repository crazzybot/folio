import React from "react";
import { agentsSentence } from "../agents";
import type { AgentSession } from "../types";
import styles from "./LivePill.module.css";

/**
 * "Live": an agent is in a review loop here, so notes sent from these
 * documents go straight to it. The dot pulses while it waits; it's still
 * while the agent works on the last notes. With `onClick`, a button: the
 * status bar's, the one place for every loop in the workspace, whose menu
 * ends them. `dot` is the dot alone, on a folder row or the focus bar: a
 * hint of where an agent listens, with the same title.
 */
export default function LivePill({
  agents,
  onClick,
  dot = false,
}: {
  agents: readonly AgentSession[];
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  dot?: boolean;
}): React.ReactElement | null {
  if (agents.length === 0) return null;
  const sentence = agentsSentence(agents);
  const waiting = agents.some((a) => a.state === "waiting");
  if (dot) {
    return (
      <span className={styles.dotOnly} role="img" aria-label={`Live: ${sentence}`} title={sentence}>
        <span className={`${styles.dot} ${waiting ? styles.waiting : ""}`} />
      </span>
    );
  }
  const content = (
    <>
      <span className={`${styles.dot} ${waiting ? styles.waiting : ""}`} aria-hidden="true" />
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
