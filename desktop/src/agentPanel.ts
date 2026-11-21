/**
 * agentPanel.ts — The agent panel: the user's coding agent (Claude Code) in
 * a terminal docked at the bottom of the window, started in the workspace.
 *
 * Markdown is untrusted, and the document view is sandboxed for that reason;
 * a page that can write to a shell would turn any sanitizer bypass into
 * running code. So the terminal is a view of its own (WebContentsView) with
 * its own preload (agentPreload.ts), the pty lives here in the main process,
 * and the agent:* channels answer only that view. The document view has no
 * way to the session.
 *
 * The session is the user's own: Folio starts it only when the panel is
 * opened, and never types into it on its own. Hiding the panel keeps it
 * running; Restart, closing the window or quitting ends it.
 *
 * The panel sits above the document page's status bar: the page leaves a
 * gap of the panel's height there (--agent-panel-height) and says how far
 * the gap's bottom is from the window's (the status bar's height). The page
 * can show and hide the panel and pick a folder in the workspace to start in;
 * it can't type into the session or read it.
 *
 * The session starts in the workspace, or in a folder of it (the folder's
 * context menu, or the focused folder when the status bar's button opens it).
 */

import { ipcMain, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { agentEnv, agentLaunch, isClaudeCommand, sessionCommand } from "./agentLaunch";
import { isDescendant, readProcessTable } from "./processTree";

const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
// Room the documents keep above the panel
const MIN_DOCUMENTS_HEIGHT = 200;
// Output kept for the page to replay when it reloads
const REPLAY_LIMIT = 512 * 1024;
// Claude Code redraws its spinner while it works: output this recent means
// it's probably mid-turn (a guess until the state hooks exist)
const BUSY_OUTPUT_MS = 1500;
// What Claude Code says when --resume finds no saved conversation
const NO_CONVERSATION = "No conversation found";
// After Start Review Loop, look for the loop this often until it shows: a
// Presence change can be missed (the process table read while it changes)
const LOOP_POLL_MS = 2000;
const LOOP_POLL_FOR_MS = 60_000;

/** The review loop of the panel's session, from its Presence file. */
export type LoopState = "off" | "waiting" | "working";

/** Why Start Review Loop asks before restarting a running session. */
export type RestartReason = "working" | "draft" | "plain";

export interface AgentPanelOptions {
  /** The panel's page (frontend/agent.html). */
  url: string;
  /** agentPreload.js. */
  preload: string;
  /** The agent's command line. */
  command: string;
  /** The workspace: the session starts there unless a folder of it was asked for. */
  workspace: () => string | null;
  /**
   * The height the panel takes from the document view (0 when hidden), and
   * the page's status bar below it (the page's CSS pixels).
   */
  onLayout: (height: number, gap: number) => void;
  /** The panel was shown or hidden, for the status bar's button. */
  onVisible: (visible: boolean) => void;
  openExternal: (url: string) => void;
  backgroundColor: () => string;
  /** Ask before Start Review Loop restarts a running session; true to go ahead. */
  confirmRestart: (reason: RestartReason) => Promise<boolean>;
  /** The review loops running now (AgentTracker), by their MCP server's pid. */
  loops: () => readonly { pid: number; state: "waiting" | "working" }[];
}

export class AgentPanel {
  private view: WebContentsView | null = null;
  private pty: IPty | null = null;
  private sessionFolder: string | null = null;
  /** The folder asked for, or null for the workspace. */
  private requestedFolder: string | null = null;
  /** The page's status bar below the panel, in the window's units. */
  private bottomGap = 0;
  private replay = "";
  private size = { cols: 80, rows: 24 };
  private visible = false;
  private height = DEFAULT_HEIGHT;
  private reserved = 0;
  private reservedGap = 0;
  /** The conversation's id (Claude Code's --session-id), new with each new session. */
  private conversation = randomUUID();
  /** Whether it has been saved: something was sent in it, so --resume finds it. */
  private hasConversation = false;
  /** Keys typed since the last Enter: a message not sent yet. */
  private draft = false;
  private lastOutputAt = 0;
  /** This session is a --resume that found no conversation: start it fresh once it exits. */
  private resumeFailed = false;
  private loop: LoopState = "off";
  private loopCheck = 0;

  constructor(
    private readonly win: BrowserWindow,
    private readonly options: AgentPanelOptions,
  ) {
    win.on("resize", () => this.layout());
    win.on("closed", () => this.dispose());
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Whether an IPC message comes from this panel's page. */
  handles(sender: WebContents): boolean {
    return this.view !== null && !this.view.webContents.isDestroyed() && sender === this.view.webContents;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /**
   * Show the panel. `folder` is where a new session starts; a running one
   * stays where it is (Open Agent Here moves it).
   */
  show(folder: string | null = null): void {
    if (this.pty === null) this.requestedFolder = folder;
    this.visible = true;
    const view = this.ensureView();
    view.setVisible(true);
    this.layout();
    view.webContents.focus();
    view.webContents.send("agent:focus");
    this.options.onVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.view?.setVisible(false);
    this.layout();
    if (!this.win.isDestroyed()) this.win.webContents.focus();
    this.options.onVisible(false);
  }

  /** Open Agent Here: show the panel with a session in `folder`, ending one elsewhere. */
  openIn(folder: string): void {
    this.requestedFolder = folder;
    this.show(folder);
    if (this.pty !== null && this.sessionFolder !== folder) this.restart();
  }

  /** A new workspace: a session outside it ends, and starts again in it if the panel is open. */
  workspaceChanged(): void {
    const workspace = this.options.workspace();
    const inside =
      workspace !== null &&
      this.requestedFolder !== null &&
      (this.requestedFolder === workspace || this.requestedFolder.startsWith(workspace + path.sep));
    if (!inside) this.requestedFolder = null;
    if (this.pty === null || this.sessionFolder === this.folder()) return;
    if (this.visible) this.restart();
    else this.end();
  }

  /** The page's status bar height below the panel, in CSS pixels of the page. */
  setBottomGap(gap: number): void {
    this.bottomGap = gap;
    this.layout();
  }

  /** The page's terminal is ready: start the session, or replay it after a reload. */
  ready(cols: number, rows: number): void {
    this.size = { cols, rows };
    if (this.pty === null) {
      this.start("new");
      return;
    }
    this.pty.resize(cols, rows);
    this.send("agent:data", this.replay);
    this.sendInfo();
    this.send("agent:loop", this.loop);
  }

  input(data: string): void {
    if (this.pty === null) return;
    this.pty.write(data);
    // Only the user's keys come here. Enter after typing sends a message,
    // which saves the conversation; Ctrl+C and Ctrl+U clear the input
    if (data.includes("\r")) {
      if (this.draft) this.hasConversation = true;
      this.draft = false;
    } else if (data === "\x03" || data === "\x15") {
      this.draft = false;
    } else if (data.startsWith("\x1b[200~") || (!data.startsWith("\x1b") && /[^\x00-\x1f\x7f]/.test(data))) {
      // Typed text, or a paste; not arrows, Esc or other keys' sequences
      this.draft = true;
    }
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    this.pty?.resize(cols, rows);
  }

  /** A new session: a new conversation, not the one before. */
  restart(): void {
    this.end();
    this.conversation = randomUUID();
    this.hasConversation = false;
    this.start("new");
  }

  /**
   * Start Review Loop: Claude Code again on this conversation, with the
   * review loop as its first prompt. A running session is ended first,
   * which stops a turn in progress and drops what lives in the process
   * (session approvals, permission mode, shells Claude started); the
   * user is asked before that.
   */
  async startReviewLoop(): Promise<void> {
    if (!isClaudeCommand(this.options.command) || this.loop !== "off") return;
    if (this.pty !== null) {
      const reason: RestartReason =
        Date.now() - this.lastOutputAt < BUSY_OUTPUT_MS ? "working" : this.draft ? "draft" : "plain";
      if (!(await this.options.confirmRestart(reason))) return;
      this.end();
    }
    this.start(this.hasConversation ? "resume-loop" : "loop");
    this.view?.webContents.focus();
    const pty = this.pty;
    const until = Date.now() + LOOP_POLL_FOR_MS;
    const poll = async () => {
      if (this.pty !== pty || pty === null || this.loop !== "off" || Date.now() > until) return;
      await this.updateLoop(this.options.loops());
      setTimeout(() => void poll(), LOOP_POLL_MS);
    };
    setTimeout(() => void poll(), LOOP_POLL_MS);
  }

  /**
   * The review loops running now (their MCP server's pid): the panel's
   * session is in one when its server descends from the panel's process.
   */
  async updateLoop(sessions: readonly { pid: number; state: "waiting" | "working" }[]): Promise<void> {
    const check = ++this.loopCheck;
    const pty = this.pty;
    let state: LoopState = "off";
    if (pty !== null && sessions.length > 0) {
      const table = await readProcessTable();
      const ours = table === null ? undefined : sessions.find((s) => isDescendant(table, s.pid, pty.pid));
      if (ours !== undefined) state = ours.state;
    }
    // A later check, or another session since, has the say
    if (check !== this.loopCheck || pty !== this.pty) return;
    this.setLoop(state);
  }

  setHeight(height: number): void {
    this.height = Math.max(MIN_HEIGHT, height);
    this.layout();
  }

  /** End the session (SIGHUP, as closing a terminal does). */
  end(): void {
    const pty = this.pty;
    this.pty = null;
    this.replay = "";
    this.draft = false;
    this.setLoop("off");
    if (pty === null) return;
    try {
      pty.kill();
    } catch {
      // Already gone
    }
  }

  dispose(): void {
    this.end();
    const view = this.view;
    this.view = null;
    if (view !== null && !view.webContents.isDestroyed()) view.webContents.close();
  }

  private folder(): string {
    return this.requestedFolder ?? this.options.workspace() ?? os.homedir();
  }

  private start(mode: "new" | "loop" | "resume-loop"): void {
    const folder = this.folder();
    const command = sessionCommand(this.options.command, this.conversation, mode);
    const launch = agentLaunch(command, process.platform, process.env);
    const pty = spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: folder,
      env: agentEnv(process.env, randomUUID()),
    });
    this.pty = pty;
    this.sessionFolder = folder;
    this.lastOutputAt = 0;
    this.resumeFailed = false;
    // The loop's first prompt is a message: the conversation is saved
    if (mode !== "new") this.hasConversation = true;
    // A session that was ended or replaced may still report; only the current one counts
    pty.onData((data) => {
      if (this.pty !== pty) return;
      this.lastOutputAt = Date.now();
      // Folio's guess that something was sent can be wrong (an Enter that
      // answered a prompt): then the resume finds nothing
      if (mode === "resume-loop" && data.includes(NO_CONVERSATION)) this.resumeFailed = true;
      this.replay = (this.replay + data).slice(-REPLAY_LIMIT);
      this.send("agent:data", data);
    });
    pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return;
      this.pty = null;
      this.setLoop("off");
      if (this.resumeFailed) {
        // Nothing to resume: the same id is free, start the loop in a new conversation
        this.hasConversation = false;
        this.start("loop");
        return;
      }
      this.send("agent:exit", exitCode);
    });
    this.sendInfo();
  }

  private sendInfo(): void {
    const claude = isClaudeCommand(this.options.command);
    this.send("agent:info", {
      title: claude ? "Claude Code" : this.options.command,
      folder: path.basename(this.sessionFolder ?? this.folder()),
      reviewLoop: claude,
    });
  }

  private setLoop(state: LoopState): void {
    if (state === this.loop) return;
    this.loop = state;
    this.send("agent:loop", state);
  }

  private send(channel: string, value: unknown): void {
    const contents = this.view?.webContents;
    if (contents !== undefined && !contents.isDestroyed()) contents.send(channel, value);
  }

  private ensureView(): WebContentsView {
    if (this.view !== null) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor(this.options.backgroundColor());
    // Links the agent prints open in the browser; the page never navigates
    view.webContents.setWindowOpenHandler(({ url }) => {
      this.options.openExternal(url);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      this.options.openExternal(url);
    });
    this.win.contentView.addChildView(view);
    void view.webContents.loadURL(this.options.url);
    this.view = view;
    return view;
  }

  private layout(): void {
    if (this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    // The page's CSS pixels are larger than the window's when it's zoomed
    const gap = Math.round(this.bottomGap * this.win.webContents.getZoomFactor());
    const panel = this.visible ? Math.max(0, Math.min(this.height, height - gap - MIN_DOCUMENTS_HEIGHT)) : 0;
    this.view?.setBounds({ x: 0, y: height - gap - panel, width, height: panel });
    if (panel !== this.reserved || this.bottomGap !== this.reservedGap) {
      this.reserved = panel;
      this.reservedGap = this.bottomGap;
      this.options.onLayout(panel, this.bottomGap);
    }
  }
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 10_000;
}

/**
 * The panel page's channels. `find` gives the panel whose page sent the
 * message; messages from any other page are dropped.
 */
export function registerAgentIpc(find: (sender: WebContents) => AgentPanel | null): void {
  const on = (channel: string, handler: (panel: AgentPanel, ...args: unknown[]) => void) => {
    ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
      const panel = find(event.sender);
      if (panel !== null) handler(panel, ...args);
    });
  };
  on("agent:ready", (panel, cols, rows) => {
    if (isSize(cols) && isSize(rows)) panel.ready(cols, rows);
  });
  on("agent:input", (panel, data) => {
    if (typeof data === "string") panel.input(data);
  });
  on("agent:resize", (panel, cols, rows) => {
    if (isSize(cols) && isSize(rows)) panel.resize(cols, rows);
  });
  on("agent:restart", (panel) => panel.restart());
  on("agent:review-loop", (panel) => void panel.startReviewLoop());
  on("agent:hide", (panel) => panel.hide());
  on("agent:height", (panel, height) => {
    if (isSize(height)) panel.setHeight(height);
  });
}
