/**
 * processTree.ts — Whether one process descends from another.
 *
 * The agent panel's Claude Code runs as the pty's process (the login shell
 * `exec`s it, agentLaunch.ts), and the Folio MCP server it starts is one of
 * its descendants (through npx). So a review loop's Presence file, which
 * names the MCP server's pid, belongs to the panel's session when that pid
 * descends from the pty's.
 */

import { execFile } from "node:child_process";

/** Each process's parent: pid → ppid. */
export type ProcessTable = Map<number, number>;

/** `ps -A -o pid=,ppid=` output as a table. */
export function parseProcessTable(output: string): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match !== null) table.set(Number(match[1]), Number(match[2]));
  }
  return table;
}

/** Whether `pid` is `ancestor` or one of its descendants. */
export function isDescendant(table: ProcessTable, pid: number, ancestor: number): boolean {
  let current: number | undefined = pid;
  // Bounded: a table read while processes come and go could hold a cycle
  for (let step = 0; step < 64 && current !== undefined && current > 1; step++) {
    if (current === ancestor) return true;
    current = table.get(current);
  }
  return false;
}

/** The running processes' parents; null where `ps` isn't available (Windows). */
export function readProcessTable(): Promise<ProcessTable | null> {
  if (process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid="], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error === null ? parseProcessTable(stdout) : null);
    });
  });
}
