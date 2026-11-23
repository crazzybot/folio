/**
 * agents.ts — Agents in a review loop with Folio. While an agent waits for
 * the user's notes (the MCP server's folio_wait_for_review), its server keeps
 * a presence file in the data folder's agents/, named by its process id; the
 * app reads them to show where an agent is listening.
 *
 * Files only say what a session last wrote, so a reader decides what's live:
 * the process still runs, and a wait hasn't passed its deadline.
 *
 * The app ends a loop by writing `<pid>.stop` beside it: the session's wait
 * returns, tells the agent to stop, and removes both files. It does so when
 * the user ends the loop, and for the sessions it shows when it closes their
 * workspace or quits: nothing can send them notes then.
 */

import { mkdirSync, promises as fs, writeFileSync } from "node:fs";
import path from "node:path";

const VERSION = 1;
// Between one wait and the next the agent replies or calls again: a waiting
// session stays live this long past its deadline
const WAIT_GRACE_MS = 60_000;
// A session working on notes longer than this was most likely stopped
const WORK_LIMIT_MS = 30 * 60_000;

export type AgentState = "waiting" | "working";
/** Why a loop ends: the user ended it, closed its workspace, or the app quit. */
export type StopReason = "ended" | "closed" | "quit";
const REASONS: readonly string[] = ["ended", "closed", "quit"] satisfies StopReason[];

/** What a session writes. */
export interface AgentPresence {
  version: number;
  pid: number;
  /** The folder the agent works in: its notes come from documents under it. */
  root: string;
  /** "Claude Code". */
  client: string;
  state: AgentState;
  /** Notes sent after this are the next ones it takes. */
  since: string;
  /** While waiting: when this wait ends. */
  until?: string;
  /**
   * The Folio agent panel session the agent runs in (FOLIO_AGENT_SESSION),
   * so the panel knows its own loop; absent elsewhere.
   */
  panelSession?: string;
  updated: string;
}

export function agentsFolder(dataDir: string): string {
  return path.join(dataDir, "agents");
}

export function presenceFile(dataDir: string, pid: number): string {
  return path.join(agentsFolder(dataDir), `${pid}.json`);
}

export function stopFile(dataDir: string, pid: number): string {
  return path.join(agentsFolder(dataDir), `${pid}.stop`);
}

function stopRecord(reason: StopReason): string {
  return JSON.stringify({ requested: new Date().toISOString(), reason }) + "\n";
}

/** Ask session `pid` to end its loop; it no longer counts as live. */
export async function requestStop(dataDir: string, pid: number, reason: StopReason = "ended"): Promise<void> {
  const file = stopFile(dataDir, pid);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, stopRecord(reason), "utf8");
}

/** `requestStop`, for the app's last moments, when nothing async gets to finish. */
export function requestStopSync(dataDir: string, pid: number, reason: StopReason): void {
  const file = stopFile(dataDir, pid);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stopRecord(reason), "utf8");
}

/** Why session `pid` was asked to stop, or null when it wasn't. */
export async function stopRequested(dataDir: string, pid: number): Promise<StopReason | null> {
  let text: string;
  try {
    text = await fs.readFile(stopFile(dataDir, pid), "utf8");
  } catch {
    return null;
  }
  try {
    const reason = (JSON.parse(text) as { reason?: unknown }).reason;
    return typeof reason === "string" && REASONS.includes(reason) ? (reason as StopReason) : "ended";
  } catch {
    // Half written, or by an older app: a stop all the same
    return "ended";
  }
}

/** Write a session's presence, whole (a reader never sees half a file). */
export async function writePresence(dataDir: string, presence: Omit<AgentPresence, "version" | "updated">): Promise<void> {
  const file = presenceFile(dataDir, presence.pid);
  const full: AgentPresence = { version: VERSION, ...presence, updated: new Date().toISOString() };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(full, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** Whether process `pid` runs (EPERM: it does, as another user's). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a session is in its loop at `now`. */
export function isLive(presence: AgentPresence, now: number, alive: (pid: number) => boolean = processAlive): boolean {
  if (!alive(presence.pid)) return false;
  if (presence.state === "waiting") {
    const until = Date.parse(presence.until ?? "");
    return !Number.isNaN(until) && now <= until + WAIT_GRACE_MS;
  }
  const updated = Date.parse(presence.updated);
  return !Number.isNaN(updated) && now - updated <= WORK_LIMIT_MS;
}

/** The sessions in a loop now, oldest first; unreadable and stale files are skipped. */
export async function liveAgents(
  dataDir: string,
  now = Date.now(),
  alive: (pid: number) => boolean = processAlive,
): Promise<AgentPresence[]> {
  const folder = agentsFolder(dataDir);
  let all: string[];
  try {
    all = await fs.readdir(folder);
  } catch {
    return [];
  }
  // Asked to stop: gone from the app at once, whenever the agent notices
  const stopping = new Set(all.filter((name) => name.endsWith(".stop")).map((name) => name.slice(0, -".stop".length)));
  const names = all.filter((name) => /^\d+\.json$/.test(name) && !stopping.has(name.slice(0, -".json".length)));
  const found: AgentPresence[] = [];
  for (const name of names) {
    try {
      const presence = parsePresence(JSON.parse(await fs.readFile(path.join(folder, name), "utf8")));
      if (presence !== null && isLive(presence, now, alive)) found.push(presence);
    } catch {
      // Unreadable, or removed while reading
    }
  }
  return found.sort((a, b) => (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : a.pid - b.pid));
}

function parsePresence(value: unknown): AgentPresence | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const strings = ["root", "client", "since", "updated"].every((key) => typeof v[key] === "string");
  if (v["version"] !== VERSION || typeof v["pid"] !== "number" || !strings) return null;
  if (v["state"] !== "waiting" && v["state"] !== "working") return null;
  if (v["until"] !== undefined && typeof v["until"] !== "string") return null;
  if (v["panelSession"] !== undefined && typeof v["panelSession"] !== "string") return null;
  return value as AgentPresence;
}
