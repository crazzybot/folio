/** The agent panel's bridge to the main process (desktop/src/agentPreload.ts). */
export interface AgentApi {
  /** The terminal is ready at this size: starts the session, or replays it after a reload. */
  ready(cols: number, rows: number): void;
  /** Keys typed in the terminal. */
  input(data: string): void;
  resize(cols: number, rows: number): void;
  /** End the session and start a new one. */
  restart(): void;
  /** Put the review loop's command on the clipboard, for the user to paste into the session. */
  copyReviewLoopCommand(): void;
  hide(): void;
  /** The panel's new height while its top edge is dragged. */
  setHeight(height: number): void;
  onData(callback: (data: string) => void): () => void;
  /** The session ended; `missing` when the shell didn't find the agent's program (not installed). */
  onExit(callback: (exit: AgentExit) => void): () => void;
  /** What runs where, for the panel's header; `reviewLoop` is the command that starts it (Claude Code), else null. */
  onInfo(callback: (info: { title: string; folder: string; reviewLoop: string | null }) => void): () => void;
  /** The session's review loop: off, waiting for notes, or working on them. */
  onLoop(callback: (state: LoopState) => void): () => void;
  /** The panel was shown: take the keyboard. */
  onFocus(callback: () => void): () => void;
}

export interface AgentExit {
  code: number;
  /** The program that wasn't found, and Claude Code's install guide when it's `claude`. */
  missing: { program: string; installUrl: string | null } | null;
}

export type LoopState = "off" | "waiting" | "working";

declare global {
  interface Window {
    agentApi?: AgentApi;
  }
}
