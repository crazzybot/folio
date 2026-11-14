/**
 * agents.ts — Agents in a review loop on the workspace (desktop): which
 * folders they listen on, and which of them get notes sent from a document.
 * The browser and the demo have none.
 */

import { useEffect, useState } from "react";
import type { AgentSession } from "./types";

/** The agents in a loop now; [] outside the desktop app. */
export function useAgents(): readonly AgentSession[] {
  const [sessions, setSessions] = useState<readonly AgentSession[]>([]);
  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    let live = true;
    api.agents.list().then(
      (initial) => {
        if (live) setSessions(initial);
      },
      () => {},
    );
    const unsubscribe = api.agents.onChange(setSessions);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return sessions;
}

/** The agents that take notes from the document at `location`. */
export function agentsFor(sessions: readonly AgentSession[], location: string): AgentSession[] {
  return sessions.filter((s) => s.location === "" || location.startsWith(`${s.location}/`));
}

/**
 * The agents listening on a folder row. A row can stand for a chain of
 * folders ("projects / api", `folders` long): any of them counts.
 */
export function agentsAtFolder(sessions: readonly AgentSession[], folderKey: string, folders = 1): AgentSession[] {
  const parts = folderKey.split("/");
  const chain = new Set<string>();
  for (let n = Math.max(1, parts.length - folders + 1); n <= parts.length; n++) chain.add(parts.slice(0, n).join("/"));
  return sessions.filter((s) => s.location !== "" && chain.has(s.location));
}

/**
 * The agents on a focused folder: listening on it or on a folder that holds
 * it. Not those on the whole workspace, which the status bar shows.
 */
export function agentsOnFolder(sessions: readonly AgentSession[], folder: string): AgentSession[] {
  return sessions.filter((s) => s.location !== "" && (folder === s.location || folder.startsWith(`${s.location}/`)));
}

/** Where the agents are, in a sentence: "Claude Code is waiting for notes in api". */
export function agentsSentence(sessions: readonly AgentSession[]): string {
  return sessions
    .map((s) => {
      const where = s.root.split(/[\\/]/).filter(Boolean).pop() ?? s.root;
      return s.state === "waiting"
        ? `${s.client} is waiting for notes in ${where}`
        : `${s.client} is working on notes in ${where}, and takes new ones next`;
    })
    .join("\n");
}
