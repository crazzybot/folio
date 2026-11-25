import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What the panel drives: Electron's view and IPC, node-pty, and `ps`. The
// session logic under them is the real one.

interface FakePty {
  pid: number;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  written: string[];
  killed: boolean;
  data: (data: string) => void;
  exit: (exitCode: number) => void;
  write(data: string): void;
  resize(): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number }) => void): void;
}

const ptys: FakePty[] = [];
const ipcHandlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => void>();
const processTable = vi.fn<() => Promise<Map<number, number> | null>>();

vi.mock("electron", () => {
  class WebContentsView {
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    visible = false;
    webContents = {
      sent: [] as [string, unknown][],
      isDestroyed: () => false,
      send(channel: string, value: unknown) {
        this.sent.push([channel, value]);
      },
      focus: () => undefined,
      close: () => undefined,
      on: () => undefined,
      setWindowOpenHandler: () => undefined,
      loadURL: () => Promise.resolve(),
    };
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }) {
      this.bounds = bounds;
    }
    setBackgroundColor() {}
  }
  return {
    WebContentsView,
    clipboard: { writeText: vi.fn() },
    ipcMain: {
      on: (channel: string, handler: (event: { sender: unknown }, ...args: unknown[]) => void) => ipcHandlers.set(channel, handler),
    },
  };
});

vi.mock("node-pty", () => ({
  spawn: (file: string, args: string[], options: { cwd: string; env: Record<string, string> }): FakePty => {
    const pty: FakePty = {
      pid: 1000 + ptys.length,
      file,
      args,
      cwd: options.cwd,
      env: options.env,
      written: [],
      killed: false,
      data: () => undefined,
      exit: () => undefined,
      write(data) {
        this.written.push(data);
      },
      resize() {},
      kill() {
        this.killed = true;
      },
      onData(callback) {
        this.data = callback;
      },
      onExit(callback) {
        this.exit = (exitCode) => callback({ exitCode });
      },
    };
    ptys.push(pty);
    return pty;
  },
}));

vi.mock("../src/processTree", async (original) => ({
  ...(await original<typeof import("../src/processTree")>()),
  readProcessTable: () => processTable(),
}));

const { AgentPanel, registerAgentIpc } = await import("../src/agentPanel");
type Panel = InstanceType<typeof AgentPanel>;

const workspace = path.join(path.sep, "work", "repo");

function fakeWindow(height = 900, width = 1200) {
  const size = { width, height };
  return {
    size,
    on: () => undefined,
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, ...size }),
    webContents: { getZoomFactor: () => 1, focus: () => undefined },
    contentView: { addChildView: () => undefined },
  };
}

function setup(options: { command?: string; windowHeight?: number; windowWidth?: number; position?: "bottom" | "right" } = {}) {
  let current: string | null = workspace;
  const layouts: [number, number, number][] = [];
  const positions: string[] = [];
  const win = fakeWindow(options.windowHeight, options.windowWidth);
  const panel: Panel = new AgentPanel(win as never, {
    url: "app://folio/agent.html",
    preload: "agentPreload.js",
    command: options.command ?? "claude",
    workspace: () => current,
    position: options.position ?? "bottom",
    onLayout: ({ height, width, gap }) => layouts.push([height, width, gap]),
    onPositionChange: (position) => positions.push(position),
    onVisible: () => undefined,
    openExternal: () => undefined,
    backgroundColor: () => "#000",
    loops: () => [],
  });
  /** The panel's page: what it was sent, and its view's place. */
  const page = () =>
    (panel as unknown as { view: { bounds: { x: number; y: number; width: number; height: number }; webContents: { sent: [string, unknown][] } } | null })
      .view;
  const sent = (channel: string) => page()?.webContents.sent.filter(([c]) => c === channel).map(([, value]) => value) ?? [];
  return {
    panel,
    win,
    layouts,
    positions,
    page,
    sent,
    setWorkspace: (folder: string | null) => {
      current = folder;
      panel.workspaceChanged();
    },
  };
}

/** Show the panel and let its page start the session, as opening it does. */
function open(panel: Panel, folder: string | null = null): FakePty {
  panel.show(folder);
  panel.ready(80, 24);
  const pty = ptys.at(-1);
  if (pty === undefined) throw new Error("No session started");
  return pty;
}

beforeEach(() => {
  ptys.length = 0;
  processTable.mockReset();
});

describe("AgentPanel sessions", () => {
  it("starts the agent in the workspace when its page is ready, naming the session", () => {
    const { panel, sent } = setup();
    panel.show();
    expect(ptys).toHaveLength(0); // not before the terminal is there
    const pty = open(panel);
    expect(pty.cwd).toBe(workspace);
    expect(pty.env["FOLIO_AGENT_SESSION"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent("agent:info")).toEqual([{ title: "Claude Code", folder: "repo", reviewLoop: "/folio:review-loop" }]);
  });

  it("replays a running session to a reloaded page instead of starting another", () => {
    const { panel, sent } = setup();
    const pty = open(panel);
    pty.data("hello");
    panel.ready(100, 30);
    expect(ptys).toHaveLength(1);
    expect(sent("agent:data")).toEqual(["hello", "hello"]);
  });

  it("passes on the user's keys, and nothing else", () => {
    const { panel } = setup();
    const pty = open(panel);
    panel.input("ls\r");
    expect(pty.written).toEqual(["ls\r"]);
  });

  it("moves the session with Open Agent Here, and keeps it for the folder it's in", () => {
    const { panel } = setup();
    const first = open(panel);
    const api = path.join(workspace, "api");
    panel.openIn(api);
    expect(first.killed).toBe(true);
    expect(ptys.at(-1)?.cwd).toBe(api);
    panel.openIn(api);
    expect(ptys).toHaveLength(2);
  });

  it("keeps a running session where it is when the panel is shown for another folder", () => {
    const { panel } = setup();
    const pty = open(panel);
    panel.hide();
    panel.show(path.join(workspace, "api"));
    expect(pty.killed).toBe(false);
    expect(ptys).toHaveLength(1);
  });

  it("ignores what an ended session still reports", () => {
    const { panel, sent } = setup();
    const old = open(panel);
    panel.restart();
    old.data("late");
    old.exit(0);
    expect(sent("agent:data")).toEqual([]);
    expect(sent("agent:exit")).toEqual([]);
  });

  it("says when the shell couldn't find the agent", () => {
    const { panel, sent } = setup();
    const pty = open(panel);
    const notFound = process.platform === "win32" ? 9009 : 127;
    pty.exit(notFound);
    expect(sent("agent:exit")).toEqual([{ code: notFound, missing: { program: "claude", installUrl: expect.stringContaining("https://") } }]);
  });
});

describe("AgentPanel and the workspace", () => {
  it("restarts an open panel's session in a new workspace", () => {
    const { panel, setWorkspace } = setup();
    const old = open(panel);
    setWorkspace(path.join(path.sep, "work", "other"));
    expect(old.killed).toBe(true);
    expect(ptys.at(-1)?.cwd).toBe(path.join(path.sep, "work", "other"));
  });

  it("ends a hidden panel's session, for the next one to start in the new workspace", () => {
    const { panel, setWorkspace } = setup();
    const old = open(panel);
    panel.hide();
    setWorkspace(path.join(path.sep, "work", "other"));
    expect(old.killed).toBe(true);
    expect(ptys).toHaveLength(1);
  });

  it("keeps a session in a folder of the workspace when the workspace is set again", () => {
    const { panel, setWorkspace } = setup();
    const pty = open(panel, path.join(workspace, "api"));
    setWorkspace(workspace);
    expect(pty.killed).toBe(false);
  });
});

describe("AgentPanel review loop", () => {
  it("finds its loop by the session the MCP server names, without reading processes", async () => {
    const { panel, sent } = setup();
    const pty = open(panel);
    const session = pty.env["FOLIO_AGENT_SESSION"];
    await panel.updateLoop([
      { pid: 1, state: "working", panelSession: "another panel" },
      { pid: 2, state: "waiting", panelSession: session },
    ]);
    expect(sent("agent:loop")).toEqual(["waiting"]);
    expect(processTable).not.toHaveBeenCalled();
  });

  it("finds an older MCP server's loop by its process descending from the session", async () => {
    const { panel, sent } = setup();
    const pty = open(panel);
    // The MCP server (502) under npx (501) under the session's agent
    processTable.mockResolvedValue(
      new Map([
        [502, 501],
        [501, pty.pid],
        [503, 99],
      ]),
    );
    await panel.updateLoop([
      { pid: 503, state: "working" },
      { pid: 502, state: "waiting" },
    ]);
    expect(sent("agent:loop")).toEqual(["waiting"]);
  });

  it("is off for loops elsewhere, and where processes can't be read (Windows)", async () => {
    const { panel, sent } = setup();
    open(panel);
    await panel.updateLoop([{ pid: 1, state: "waiting", panelSession: "another panel" }]);
    processTable.mockResolvedValue(null);
    await panel.updateLoop([{ pid: 2, state: "waiting" }]);
    expect(sent("agent:loop")).toEqual([]);
  });

  it("goes off when the session ends", async () => {
    const { panel, sent } = setup();
    const pty = open(panel);
    await panel.updateLoop([{ pid: 2, state: "waiting", panelSession: pty.env["FOLIO_AGENT_SESSION"] }]);
    panel.restart();
    expect(sent("agent:loop")).toEqual(["waiting", "off"]);
  });
});

describe("AgentPanel layout", () => {
  it("takes its height from the documents, leaving them room", () => {
    const { panel, layouts, page } = setup({ windowHeight: 600 });
    panel.setBottomGap(24);
    panel.show();
    expect(layouts.at(-1)).toEqual([320, 0, 24]);
    expect(page()?.bounds).toMatchObject({ y: 600 - 24 - 320, height: 320 });
    panel.setHeight(5000);
    // 600 - 24 for the status bar - 200 the documents keep
    expect(layouts.at(-1)).toEqual([376, 0, 24]);
    panel.hide();
    expect(layouts.at(-1)).toEqual([0, 0, 24]);
  });

  it("on the right, takes its width beside the documents, above the status bar", () => {
    const { panel, layouts, page, sent } = setup({ windowHeight: 800, windowWidth: 1600, position: "right" });
    panel.setBottomGap(24);
    panel.show();
    expect(layouts.at(-1)).toEqual([0, 640, 24]);
    expect(page()?.bounds).toEqual({ x: 1600 - 640, y: 0, width: 640, height: 800 - 24 });
    expect(sent("agent:place").at(-1)).toEqual({ position: "right", rightFits: true });
    panel.setWidth(5000);
    // 1600 - 520 the documents keep
    expect(layouts.at(-1)).toEqual([0, 1080, 24]);
    panel.setWidth(10);
    expect(layouts.at(-1)).toEqual([0, 360, 24]);
  });

  it("moves to the right and back, remembering it", () => {
    const { panel, layouts, positions, sent } = setup({ windowWidth: 1600 });
    panel.show();
    panel.setPosition("right");
    expect(layouts.at(-1)).toEqual([0, 640, 0]);
    expect(panel.preferredPosition).toBe("right");
    panel.setPosition("bottom");
    expect(layouts.at(-1)).toEqual([320, 0, 0]);
    expect(positions).toEqual(["right", "bottom"]);
    expect(sent("agent:place")).toEqual([
      { position: "bottom", rightFits: true },
      { position: "right", rightFits: true },
      { position: "bottom", rightFits: true },
    ]);
  });

  it("goes to the bottom in a window too narrow for it on the right, and back once it's wide enough", () => {
    const { panel, win, layouts, sent } = setup({ windowWidth: 800, position: "right" });
    panel.show();
    expect(layouts.at(-1)).toEqual([320, 0, 0]);
    expect(sent("agent:place").at(-1)).toEqual({ position: "bottom", rightFits: false });
    expect(panel.preferredPosition).toBe("right");
    win.size.width = 1200;
    panel.setBottomGap(0); // a layout, as the window's resize event gives
    expect(layouts.at(-1)).toEqual([0, 640, 0]);
    expect(sent("agent:place").at(-1)).toEqual({ position: "right", rightFits: true });
  });

  it("tells a reloaded page where it is", () => {
    const { panel, sent } = setup({ windowWidth: 1600, position: "right" });
    open(panel);
    const before = sent("agent:place").length;
    panel.ready(80, 24);
    expect(sent("agent:place")).toHaveLength(before + 1);
    expect(sent("agent:place").at(-1)).toEqual({ position: "right", rightFits: true });
  });
});

describe("registerAgentIpc", () => {
  it("answers only the panel's own page, and only well-formed messages", () => {
    const { panel, page } = setup();
    const pty = open(panel);
    registerAgentIpc((sender) => (sender === page()?.webContents ? panel : null));
    const input = ipcHandlers.get("agent:input");
    const height = ipcHandlers.get("agent:height");
    const position = ipcHandlers.get("agent:position");
    if (input === undefined || height === undefined || position === undefined) throw new Error("Not registered");
    input({ sender: page()?.webContents }, "y");
    input({ sender: {} }, "rm -rf ~\r"); // the document view, say
    input({ sender: page()?.webContents }, 42);
    expect(pty.written).toEqual(["y"]);
    const spy = vi.spyOn(panel, "setHeight");
    height({ sender: page()?.webContents }, -5);
    height({ sender: page()?.webContents }, 1.5);
    expect(spy).not.toHaveBeenCalled();
    const move = vi.spyOn(panel, "setPosition");
    position({ sender: page()?.webContents }, "left");
    position({ sender: {} }, "right");
    expect(move).not.toHaveBeenCalled();
  });
});
