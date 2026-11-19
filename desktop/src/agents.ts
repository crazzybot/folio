/**
 * agents.ts — Agents in a review loop on the open workspace: sessions of the
 * MCP server waiting for the user's notes (packages/core/src/agents.ts),
 * pushed to the windows as they start, work and stop. Their loops end when
 * the app can no longer send them notes: their workspace is closed, or the
 * app quits.
 */

import { mkdirSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import { agentsFolder, liveAgents, requestStop, requestStopSync } from "../../packages/core/src/agents";
import type { AgentPresence, AgentState, StopReason } from "../../packages/core/src/agents";
import { realPath } from "../../packages/core/src/marks";

// A deadline passes without a file changing: check again this often
const RECHECK_MS = 15_000;
const SETTLE_MS = 200;

/** A session the workspace's documents can be sent to (frontend/src/types.ts). */
export interface AgentSession {
  /** The session's MCP server process: how the app asks it to end its loop. */
  pid: number;
  /** Its folder's workspace location ("projects/api"); "" when it's the workspace or holds it. */
  location: string;
  root: string;
  client: string;
  state: AgentState;
}

/**
 * The sessions whose folder overlaps `workspace`: inside it, or holding it
 * (an agent in the repository, the workspace one of its folders).
 */
export function sessionsFor(workspace: string, presences: readonly AgentPresence[], platform = process.platform): AgentSession[] {
  const ws = realPath(workspace);
  const sessions: AgentSession[] = [];
  for (const p of presences) {
    const root = realPath(p.root);
    const location = locate(ws, root, platform);
    if (location !== null) sessions.push({ pid: p.pid, location, root, client: p.client, state: p.state });
  }
  return sessions;
}

/** A session folder's workspace location (see AgentSession), or null when it doesn't overlap the workspace. */
function locate(workspace: string, root: string, platform: NodeJS.Platform): string | null {
  const fold = (p: string) => (platform === "darwin" || platform === "win32" ? p.toLowerCase() : p);
  const inside = path.relative(fold(workspace), fold(root));
  if (within(path.relative(fold(root), fold(workspace)))) return "";
  // In the folder's own case: the folded one only tells whether it's inside
  if (within(inside)) return root.slice(root.length - inside.length).split(path.sep).join("/");
  return null;
}

/** Whether a path.relative result stays inside its base (or is the base). */
function within(relative: string): boolean {
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class AgentTracker {
  private workspace: string | null = null;
  private sessions: AgentSession[] = [];
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private settle: NodeJS.Timeout | undefined = undefined;

  constructor(
    private readonly dataDir: string,
    private readonly onChange: (sessions: AgentSession[]) => void,
  ) {}

  start(): void {
    const folder = agentsFolder(this.dataDir);
    try {
      // The app's own data folder: made so it can be watched before any agent starts
      mkdirSync(folder, { recursive: true });
      this.watcher = watch(folder, () => {
        clearTimeout(this.settle);
        this.settle = setTimeout(() => void this.refresh(), SETTLE_MS);
      });
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // Not watchable: the timer still notices sessions, more slowly
    }
    this.timer = setInterval(() => void this.refresh(), RECHECK_MS);
    this.timer.unref();
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this.settle);
  }

  /**
   * Show the sessions on `workspace`. Those shown on the one closed that it
   * doesn't overlap end their loop: the app can't send them notes any more.
   */
  setWorkspace(workspace: string | null): void {
    const ws = workspace === null ? null : realPath(workspace);
    const left =
      workspace === this.workspace ? [] : this.sessions.filter((s) => ws === null || locate(ws, s.root, process.platform) === null);
    this.workspace = workspace;
    void this.endLoops(left, "closed").finally(() => this.refresh());
  }

  private async endLoops(sessions: readonly AgentSession[], reason: StopReason): Promise<void> {
    for (const session of sessions) {
      try {
        await requestStop(this.dataDir, session.pid, reason);
      } catch {
        // Unwritable data folder: that session waits until its timeout
      }
    }
  }

  current(): AgentSession[] {
    return this.sessions;
  }

  /** Ask session `pid` to end its loop; the windows stop showing it at once. */
  async endLoop(pid: number): Promise<void> {
    await requestStop(this.dataDir, pid);
    await this.refresh();
  }

  /**
   * The app is quitting: end the loop of every session it shows, since
   * nothing can send them notes now. Synchronous, so the files are written
   * before the process exits.
   */
  endAllOnQuit(): void {
    for (const session of this.sessions) {
      try {
        requestStopSync(this.dataDir, session.pid, "quit");
      } catch {
        // Unwritable data folder: that session waits until its timeout
      }
    }
    this.sessions = [];
  }

  async refresh(): Promise<void> {
    const workspace = this.workspace;
    const sessions = workspace === null ? [] : sessionsFor(workspace, await liveAgents(this.dataDir));
    // Another workspace was opened meanwhile: its own refresh counts
    if (workspace !== this.workspace) return;
    if (JSON.stringify(sessions) === JSON.stringify(this.sessions)) return;
    this.sessions = sessions;
    this.onChange(sessions);
  }
}
