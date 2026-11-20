/** The agent panel's bridge to the main process (desktop/src/agentPreload.ts). */
export interface AgentApi {
  /** The terminal is ready at this size: starts the session, or replays it after a reload. */
  ready(cols: number, rows: number): void;
  /** Keys typed in the terminal. */
  input(data: string): void;
  resize(cols: number, rows: number): void;
  /** End the session and start a new one. */
  restart(): void;
  hide(): void;
  /** The panel's new height while its top edge is dragged. */
  setHeight(height: number): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (code: number) => void): () => void;
  /** What runs where, for the panel's header. */
  onInfo(callback: (info: { title: string; folder: string }) => void): () => void;
  /** The panel was shown: take the keyboard. */
  onFocus(callback: () => void): () => void;
}

declare global {
  interface Window {
    agentApi?: AgentApi;
  }
}
