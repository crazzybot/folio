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
import type { AgentApi } from "./agentApi";

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

function header(api: AgentApi, terminal: Terminal): { root: HTMLElement; title: HTMLElement } {
  const root = document.createElement("header");
  root.className = "bar";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Agent";
  const restart = document.createElement("button");
  restart.textContent = "Restart";
  restart.setAttribute("aria-label", "Restart Agent Session");
  restart.addEventListener("click", () => {
    terminal.reset();
    api.restart();
  });
  const hide = document.createElement("button");
  hide.textContent = "Hide";
  hide.setAttribute("aria-label", "Hide Agent Panel");
  hide.addEventListener("click", () => api.hide());
  root.append(title, restart, hide);

  // Dragging the bar resizes the panel. Screen coordinates: the view itself
  // moves while it's resized, so its own coordinates would drift.
  root.addEventListener("pointerdown", (event) => {
    if (event.target !== root && event.target !== title) return;
    const startY = event.screenY;
    const startHeight = window.innerHeight;
    root.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => api.setHeight(Math.round(startHeight - (moved.screenY - startY)));
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  });
  return { root, title };
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
  document.body.append(bar.root, host);

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
  api.onExit((code) => {
    ended = true;
    terminal.write(`\r\n\x1b[2m[The session ended (${code}). Press any key to start a new one.]\x1b[0m\r\n`);
  });
  api.onInfo(({ title, folder }) => {
    bar.title.textContent = `${title} · ${folder}`;
  });
  api.onFocus(() => terminal.focus());

  new ResizeObserver(() => fit.fit()).observe(host);
  lightQuery.addEventListener("change", () => applyTheme(terminal));
  api.ready(terminal.cols, terminal.rows);
  terminal.focus();
}

if (window.agentApi !== undefined) start(window.agentApi);
