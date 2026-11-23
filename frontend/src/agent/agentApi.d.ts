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
  onExit(callback: (code: number) => void): () => void;
  /** What runs where, for the panel's header; `reviewLoop` is the command that starts it (Claude Code), else null. */
  onInfo(callback: (info: { title: string; folder: string; reviewLoop: string | null }) => void): () => void;
  /** The session's review loop: off, waiting for notes, or working on them. */
  onLoop(callback: (state: LoopState) => void): () => void;
  /** The panel was shown: take the keyboard. */
  onFocus(callback: () => void): () => void;
}

export type LoopState = "off" | "waiting" | "working";

declare global {
  interface Window {
    agentApi?: AgentApi;
  }
}
