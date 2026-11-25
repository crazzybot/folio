/**
 * agentPanel.ts — The agent panel: the user's coding agent (Claude Code) in
 * a terminal docked at the bottom or the right of the window, started in the
 * workspace.
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
 * The panel sits above the document page's status bar: at the bottom, the
 * page leaves a gap of the panel's height there (--agent-panel-height); on
 * the right, a column of its width beside the documents
 * (--agent-panel-width). The page says how far the gap's bottom is from the
 * window's (the status bar's height). A window too narrow for the panel
 * beside the documents gets it at the bottom, until it's wide enough again.
 * The page can show and hide the panel and pick a folder in the workspace to
 * start in; it can't type into the session or read it.
 *
 * The session starts in the workspace, or in a folder of it (the folder's
 * context menu, or the focused folder when the status bar's button opens it).
 */

import { clipboard, ipcMain, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { agentEnv, agentLaunch, isClaudeCommand, missingAgent, REVIEW_LOOP_COMMAND } from "./agentLaunch";
import { isDescendant, readProcessTable } from "./processTree";

const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
// Room the documents keep above the panel
const MIN_DOCUMENTS_HEIGHT = 200;
// On the right: about 60 columns of Claude Code's output at the default font,
// leaving the documents most of a laptop's window
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 360;
// Room the documents keep beside the panel: a narrower window gets it at the bottom
const MIN_DOCUMENTS_WIDTH = 520;
// Output kept for the page to replay when it reloads
const REPLAY_LIMIT = 512 * 1024;
// After the review loop's command is copied, look for the loop this often
// until it shows, for as long as pasting it might take: a Presence change
// can be missed (the process table read while it changes)
const LOOP_POLL_MS = 2000;
const LOOP_POLL_FOR_MS = 120_000;

/** Where the panel docks. */
export type PanelPosition = "bottom" | "right";

export function isPanelPosition(value: unknown): value is PanelPosition {
  return value === "bottom" || value === "right";
}

/**
 * The room the panel takes from the document page, in the window's units:
 * its height at the bottom or its width on the right (the other is 0, both
 * when hidden), and the page's status bar below it (the page's CSS pixels).
 */
export interface PanelLayout {
  height: number;
  width: number;
  gap: number;
}

/** The panel's size as the user left it: its height at the bottom, its width on the right. */
export interface PanelSize {
  width: number;
  height: number;
}

/** A size kept from an earlier run, or null if it isn't one. */
export function panelSize(value: unknown): PanelSize | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as Record<string, unknown>;
  return isSize(width) && isSize(height) ? { width, height } : null;
}

/** Where the panel is, for its header. */
export interface PanelPlace {
  /** Where it shows now: at the bottom in a window too narrow for the right. */
  position: PanelPosition;
  /** Whether it can show on the right in this window. */
  rightFits: boolean;
}

/** The review loop of the panel's session, from its Presence file. */
export type LoopState = "off" | "waiting" | "working";

/** A review loop running now (AgentTracker's sessions). */
export interface RunningLoop {
  /** Its MCP server's process. */
  pid: number;
  state: "waiting" | "working";
  /** The panel session it runs in: written by MCP servers since FOLIO_AGENT_SESSION. */
  panelSession?: string;
}

export interface AgentPanelOptions {
  /** The panel's page (frontend/agent.html). */
  url: string;
  /** agentPreload.js. */
  preload: string;
  /** The agent's command line. */
  command: string;
  /** The workspace: the session starts there unless a folder of it was asked for. */
  workspace: () => string | null;
  /** Where the user put the panel last (View → Agent Panel Position). */
  position: PanelPosition;
  /** The size the user left it at, or null for the defaults. */
  size: PanelSize | null;
  /** The room the panel takes from the document view, whenever it changes. */
  onLayout: (layout: PanelLayout) => void;
  /** The user moved the panel, to remember. */
  onPositionChange: (position: PanelPosition) => void;
  /** The user resized the panel, to remember. */
  onSizeChange: (size: PanelSize) => void;
  /** The panel was shown or hidden, for the status bar's button. */
  onVisible: (visible: boolean) => void;
  openExternal: (url: string) => void;
  backgroundColor: () => string;
  /** The review loops running now (AgentTracker). */
  loops: () => readonly RunningLoop[];
}

export class AgentPanel {
  private view: WebContentsView | null = null;
  private pty: IPty | null = null;
  /** The running session's FOLIO_AGENT_SESSION, which its review loop's Presence file names. */
  private session: string | null = null;
  private sessionFolder: string | null = null;
  /** The folder asked for, or null for the workspace. */
  private requestedFolder: string | null = null;
  /** The page's status bar below the panel, in the window's units. */
  private bottomGap = 0;
  private replay = "";
  private size = { cols: 80, rows: 24 };
  private visible = false;
  private height = DEFAULT_HEIGHT;
  private width = DEFAULT_WIDTH;
  private position: PanelPosition;
  private reserved: PanelLayout = { height: 0, width: 0, gap: 0 };
  /** The place last sent to the page. */
  private place: PanelPlace | null = null;
  private loop: LoopState = "off";
  private loopCheck = 0;

  constructor(
    private readonly win: BrowserWindow,
    private readonly options: AgentPanelOptions,
  ) {
    this.position = options.position;
    this.width = Math.max(MIN_WIDTH, options.size?.width ?? DEFAULT_WIDTH);
    this.height = Math.max(MIN_HEIGHT, options.size?.height ?? DEFAULT_HEIGHT);
    win.on("resize", () => this.layout());
    win.on("closed", () => this.dispose());
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Where the user put the panel: it may show at the bottom while the window is too narrow. */
  get preferredPosition(): PanelPosition {
    return this.position;
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
    if (this.place !== null) this.send("agent:place", this.place);
    if (this.pty === null) {
      this.start();
      return;
    }
    this.pty.resize(cols, rows);
    this.send("agent:data", this.replay);
    this.sendInfo();
    this.send("agent:loop", this.loop);
  }


  /** The user's keys: the only thing that goes into the session. */
  input(data: string): void {
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    this.pty?.resize(cols, rows);
  }

  restart(): void {
    this.end();
    this.start();
  }

  /**
   * Copy the review loop's command for the user to paste into the session.
   * Folio never types into it, nor starts it with a prompt of its own: the
   * user sends the command, so no prompt reaches Claude without them. Then
   * watch for the loop, so the header shows it once it's waiting.
   */
  copyReviewLoopCommand(): void {
    if (!isClaudeCommand(this.options.command)) return;
    clipboard.writeText(REVIEW_LOOP_COMMAND);
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
   * The review loops running now: the panel's session is in the one that
   * names it. An MCP server too old to name it is the session's when it
   * descends from the panel's process (not on Windows, without `ps`).
   */
  async updateLoop(sessions: readonly RunningLoop[]): Promise<void> {
    const check = ++this.loopCheck;
    const pty = this.pty;
    const session = this.session;
    let ours = sessions.find((s) => session !== null && s.panelSession === session);
    const unnamed = sessions.filter((s) => s.panelSession === undefined);
    if (ours === undefined && pty !== null && unnamed.length > 0) {
      const table = await readProcessTable();
      ours = table === null ? undefined : unnamed.find((s) => isDescendant(table, s.pid, pty.pid));
    }
    const state: LoopState = pty === null || ours === undefined ? "off" : ours.state;
    // A later check, or another session since, has the say
    if (check !== this.loopCheck || pty !== this.pty) return;
    this.setLoop(state);
  }

  setHeight(height: number): void {
    this.height = Math.max(MIN_HEIGHT, height);
    this.layout();
    this.options.onSizeChange({ width: this.width, height: this.height });
  }

  setWidth(width: number): void {
    this.width = Math.max(MIN_WIDTH, width);
    this.layout();
    this.options.onSizeChange({ width: this.width, height: this.height });
  }

  /** Dock the panel at the bottom or on the right, and remember it. */
  setPosition(position: PanelPosition): void {
    if (position === this.position) return;
    this.position = position;
    this.layout();
    this.options.onPositionChange(position);
    if (this.visible) this.view?.webContents.focus();
  }

  /** End the session (SIGHUP, as closing a terminal does). */
  end(): void {
    const pty = this.pty;
    this.pty = null;
    this.session = null;
    this.replay = "";
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

  private start(): void {
    const folder = this.folder();
    const launch = agentLaunch(this.options.command, process.platform, process.env);
    const session = randomUUID();
    const pty = spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: folder,
      env: agentEnv(process.env, session),
    });
    this.pty = pty;
    this.session = session;
    this.sessionFolder = folder;
    // A session that was ended or replaced may still report; only the current one counts
    pty.onData((data) => {
      if (this.pty !== pty) return;
      this.replay = (this.replay + data).slice(-REPLAY_LIMIT);
      this.send("agent:data", data);
    });
    pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return;
      this.pty = null;
      this.setLoop("off");
      this.send("agent:exit", { code: exitCode, missing: missingAgent(this.options.command, exitCode, process.platform) });
    });
    this.sendInfo();
  }

  private sendInfo(): void {
    const claude = isClaudeCommand(this.options.command);
    this.send("agent:info", {
      title: claude ? "Claude Code" : this.options.command,
      folder: path.basename(this.sessionFolder ?? this.folder()),
      // The command the header offers to copy; none for other agents
      reviewLoop: claude ? REVIEW_LOOP_COMMAND : null,
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
    const rightFits = width >= MIN_WIDTH + MIN_DOCUMENTS_WIDTH;
    const position = this.position === "right" && rightFits ? "right" : "bottom";
    let reserved: PanelLayout;
    if (position === "right") {
      const panel = this.visible ? Math.min(this.width, width - MIN_DOCUMENTS_WIDTH) : 0;
      this.view?.setBounds({ x: width - panel, y: 0, width: panel, height: Math.max(0, height - gap) });
      reserved = { height: 0, width: panel, gap: this.bottomGap };
    } else {
      const panel = this.visible ? Math.max(0, Math.min(this.height, height - gap - MIN_DOCUMENTS_HEIGHT)) : 0;
      this.view?.setBounds({ x: 0, y: height - gap - panel, width, height: panel });
      reserved = { height: panel, width: 0, gap: this.bottomGap };
    }
    const was = this.reserved;
    if (reserved.height !== was.height || reserved.width !== was.width || reserved.gap !== was.gap) {
      this.reserved = reserved;
      this.options.onLayout(reserved);
    }
    // Recorded only once there's a page to tell (it's told again when it's ready)
    if (this.view !== null && (this.place?.position !== position || this.place.rightFits !== rightFits)) {
      this.place = { position, rightFits };
      this.send("agent:place", this.place);
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
  on("agent:copy-review-loop", (panel) => panel.copyReviewLoopCommand());
  on("agent:hide", (panel) => panel.hide());
  on("agent:height", (panel, height) => {
    if (isSize(height)) panel.setHeight(height);
  });
  on("agent:width", (panel, width) => {
    if (isSize(width)) panel.setWidth(width);
  });
  on("agent:position", (panel, position) => {
    if (isPanelPosition(position)) panel.setPosition(position);
  });
}
