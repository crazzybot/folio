/**
 * The agent panel: a terminal running the user's coding agent (Claude Code)
 * in the workspace. Its own page and view, apart from the document UI: only
 * this page can reach the session (desktop/src/agentPanel.ts).
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import "../index.css";
import "./agent.css";
import type { AgentApi, AgentExit, LoopState, PanelPosition } from "./agentApi";

const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

/** The terminal's colours, from the app's palette (index.css). */
function terminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: token("--color-bg"),
    foreground: token("--color-text"),
    cursor: token("--color-text-strong"),
    selectionBackground: token("--color-selected-focus-bg"),
  };
}

function applyTheme(terminal: Terminal | null): void {
  document.documentElement.dataset["theme"] = lightQuery.matches ? "light" : "dark";
  if (terminal !== null) terminal.options.theme = terminalTheme();
}

interface Header {
  root: HTMLElement;
  title: HTMLElement;
  /** Show the review loop's state, or the button to start it. */
  setLoop(state: LoopState, command: string | null): void;
  /** Where the panel shows: the move button offers the other side. */
  setPlace(position: PanelPosition, rightFits: boolean): void;
}

const SVG = "http://www.w3.org/2000/svg";

/** A window with the panel at the bottom or on the right, as VS Code's panel position icons. */
function positionIcon(position: PanelPosition): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");
  const frame = document.createElementNS(SVG, "rect");
  frame.setAttribute("x", "1.5");
  frame.setAttribute("y", "2.5");
  frame.setAttribute("width", "11");
  frame.setAttribute("height", "9");
  frame.setAttribute("rx", "1");
  frame.setAttribute("fill", "none");
  frame.setAttribute("stroke", "currentColor");
  const panel = document.createElementNS(SVG, "rect");
  const box = position === "right" ? ["8", "2.5", "4.5", "9"] : ["1.5", "7.5", "11", "4"];
  for (const [i, name] of ["x", "y", "width", "height"].entries()) panel.setAttribute(name, box[i] ?? "0");
  panel.setAttribute("fill", "currentColor");
  svg.append(frame, panel);
  return svg;
}

function header(api: AgentApi, terminal: Terminal): Header {
  const root = document.createElement("header");
  root.className = "bar";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Agent";
  // The review loop: Claude waits for the notes sent from Folio
  const loop = document.createElement("span");
  loop.className = "loop";
  loop.hidden = true;
  // Off: the command that starts it, to copy and paste into the session.
  // Folio doesn't send it: only the user's keys go in
  const offer = document.createElement("span");
  offer.className = "loopOffer";
  offer.hidden = true;
  offer.title = "Paste it in the panel and press Enter: Claude waits for the notes you send from Folio. Esc stops it.";
  const command = document.createElement("code");
  const copy = document.createElement("button");
  copy.textContent = "Copy";
  let copied: number | undefined;
  copy.addEventListener("click", () => {
    api.copyReviewLoopCommand();
    copy.textContent = "Copied";
    window.clearTimeout(copied);
    copied = window.setTimeout(() => (copy.textContent = "Copy"), 2000);
    // Ready for ⌘V / Ctrl+V and Enter
    terminal.focus();
  });
  offer.append(command, copy);
  const restart = document.createElement("button");
  restart.textContent = "Restart";
  restart.setAttribute("aria-label", "Restart Agent Session");
  restart.addEventListener("click", () => {
    terminal.reset();
    api.restart();
  });
  // Moves the panel to the other side: the side it would go to is on the icon
  const move = document.createElement("button");
  move.className = "move";
  let moveTo: PanelPosition = "right";
  move.addEventListener("click", () => api.setPosition(moveTo));
  const hide = document.createElement("button");
  hide.textContent = "Hide";
  hide.setAttribute("aria-label", "Hide Agent Panel");
  hide.addEventListener("click", () => api.hide());
  root.append(title, loop, offer, restart, move, hide);

  // At the bottom, dragging the bar resizes the panel (on the right, its
  // left edge: see sash)
  root.addEventListener("pointerdown", (event) => {
    if (document.documentElement.dataset["position"] === "right") return;
    if (event.target !== root && event.target !== title) return;
    drag(root, event, (_width, height) => api.setHeight(height));
  });

  const setLoop = (state: LoopState, loopCommand: string | null) => {
    offer.hidden = loopCommand === null || state !== "off";
    command.textContent = loopCommand ?? "";
    copy.setAttribute("aria-label", `Copy ${loopCommand ?? ""}`);
    loop.hidden = state === "off";
    loop.dataset["state"] = state;
    loop.textContent = state === "waiting" ? "Waiting for your notes" : "Working on your notes";
    loop.title = state === "waiting" ? "Notes you send from Folio go to Claude. Press Esc in the panel to stop waiting." : "";
  };
  const setPlace = (position: PanelPosition, rightFits: boolean) => {
    document.documentElement.dataset["position"] = position;
    moveTo = position === "right" ? "bottom" : "right";
    move.replaceChildren(positionIcon(moveTo));
    // A window too narrow for the panel beside the documents keeps it at the bottom
    move.disabled = moveTo === "right" && !rightFits;
    const label = moveTo === "right" ? "Move Agent Panel to the Right" : "Move Agent Panel to the Bottom";
    move.setAttribute("aria-label", label);
    move.title = move.disabled ? "Widen the window to put the panel on the right" : label;
  };
  setPlace("bottom", true);
  return { root, title, setLoop, setPlace };
}

/**
 * Follows a drag of the panel's top or left edge from `event` until the
 * pointer is released, calling `onMove` with the panel's new size. In screen
 * coordinates: the view itself moves and resizes with the drag, so its own
 * coordinates would drift.
 */
function drag(target: HTMLElement, event: PointerEvent, onMove: (width: number, height: number) => void): void {
  const startX = event.screenX;
  const startY = event.screenY;
  const width = window.innerWidth;
  const height = window.innerHeight;
  target.setPointerCapture(event.pointerId);
  const move = (moved: PointerEvent) =>
    onMove(Math.round(width - (moved.screenX - startX)), Math.round(height - (moved.screenY - startY)));
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
}

/** What the terminal says when the session ends: how to install the agent, when the shell couldn't find it. */
function exitMessage({ code, missing }: AgentExit): string {
  const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
  if (missing === null) return `\r\n${dim(`[The session ended (${code}). Press any key to start a new one.]`)}\r\n`;
  const lines =
    missing.installUrl === null
      ? [`Folio couldn't find ${missing.program}. Check that it's installed and on your shell's PATH.`]
      : [
          "Claude Code isn't installed, or your shell can't find claude.",
          `Install it (${missing.installUrl}), then start a new session.`,
        ];
  return `\r\n${lines.join("\r\n")}\r\n${dim("[Press any key to try again.]")}\r\n`;
}

function start(api: AgentApi): void {
  applyTheme(null);
  const terminal = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: false,
    macOptionIsMeta: true,
    theme: terminalTheme(),
  });
  const bar = header(api, terminal);
  const host = document.createElement("div");
  host.className = "terminal";
  // On the right, the left edge resizes the panel
  const sash = document.createElement("div");
  sash.className = "sash";
  sash.setAttribute("aria-hidden", "true");
  sash.addEventListener("pointerdown", (event) => drag(sash, event, (width) => api.setWidth(width)));
  document.body.append(bar.root, host, sash);

  const fit = new FitAddon();
  terminal.loadAddon(fit);
  // Links open in the browser: the main process turns window.open into that
  terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)));
  terminal.open(host);
  fit.fit();

  let ended = false;
  terminal.onData((data) => {
    if (ended) {
      // Any key after the session ended starts a new one
      ended = false;
      terminal.reset();
      api.restart();
      return;
    }
    api.input(data);
  });
  terminal.onResize(({ cols, rows }) => api.resize(cols, rows));
  api.onData((data) => terminal.write(data));
  api.onExit((exit) => {
    ended = true;
    terminal.write(exitMessage(exit));
  });
  let loopCommand: string | null = null;
  let loopState: LoopState = "off";
  api.onInfo(({ title, folder, reviewLoop }) => {
    bar.title.textContent = `${title} · ${folder}`;
    loopCommand = reviewLoop;
    bar.setLoop(loopState, loopCommand);
  });
  api.onLoop((state) => {
    loopState = state;
    bar.setLoop(loopState, loopCommand);
  });
  api.onFocus(() => terminal.focus());
  api.onPlace(({ position, rightFits }) => bar.setPlace(position, rightFits));

  new ResizeObserver(() => fit.fit()).observe(host);
  lightQuery.addEventListener("change", () => applyTheme(terminal));
  api.ready(terminal.cols, terminal.rows);
  terminal.focus();
}

if (window.agentApi !== undefined) start(window.agentApi);
