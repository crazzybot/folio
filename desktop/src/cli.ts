/**
 * cli.ts — Installs the `folio` shell command on macOS, like VS Code's
 * "Install 'code' command in PATH": a small script in /usr/local/bin that
 * opens its arguments (files or folders), or the current folder, in this
 * app through `open -a`, which reaches a running app as an open-file event.
 *
 * Windows and Linux need no script: the app's executable takes the same
 * arguments (`Folio.exe notes\`, `folio.AppImage guide.md`).
 */

import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const COMMAND_PATH = "/usr/local/bin/folio";
// Marks a script we wrote, so reinstalling never overwrites someone else's `folio` unasked
const MARKER = "# Installed by Folio";

/** The running .app bundle, or null when not running from one (e.g. `electron .`). */
function appBundlePath(): string | null {
  if (process.platform !== "darwin" || !app.isPackaged) return null;
  // …/Folio.app/Contents/MacOS/Folio
  const bundle = path.resolve(app.getPath("exe"), "..", "..", "..");
  return bundle.endsWith(".app") ? bundle : null;
}

/** Whether the Install menu item applies on this platform and build. */
export function canInstallCommand(): boolean {
  return appBundlePath() !== null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandScript(bundle: string): string {
  return [
    "#!/bin/sh",
    MARKER,
    "# Opens Markdown files or folders in Folio; with no arguments, the current folder.",
    '[ "$#" -eq 0 ] && set -- .',
    `exec open -a ${shellQuote(bundle)} "$@"`,
    "",
  ].join("\n");
}

/** Run `osascript -e <script>`; resolves when it succeeds. */
function osascript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (error) => (error ? reject(error) : resolve()));
  });
}

/** AppleScript string literal. */
function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Write the script to COMMAND_PATH, asking for an administrator password if needed. */
async function writeCommand(contents: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(COMMAND_PATH), { recursive: true });
    await fs.writeFile(COMMAND_PATH, contents, { mode: 0o755 });
    await fs.chmod(COMMAND_PATH, 0o755);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw error;
  }
  // /usr/local/bin is often root-owned: copy a temp file into place as admin
  const temp = path.join(app.getPath("temp"), `folio-command-${process.pid}`);
  await fs.writeFile(temp, contents, { mode: 0o755 });
  try {
    const shell = `mkdir -p /usr/local/bin && cp ${shellQuote(temp)} ${COMMAND_PATH} && chmod 755 ${COMMAND_PATH}`;
    await osascript(`do shell script ${appleScriptString(shell)} with administrator privileges`);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/** Folio → Install 'folio' Command in PATH… */
export async function installCommand(win: BrowserWindow): Promise<void> {
  const bundle = appBundlePath();
  if (bundle === null) return;

  const existing = await fs.readFile(COMMAND_PATH, "utf8").catch(() => null);
  if (existing !== null && !existing.includes(MARKER)) {
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      message: `${COMMAND_PATH} already exists`,
      detail: "It wasn't installed by Folio. Replace it with the folio command?",
      buttons: ["Replace", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  }

  try {
    await writeCommand(commandScript(bundle));
  } catch (error) {
    // Cancelling the password prompt lands here too
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Couldn't install the folio command",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await dialog.showMessageBox(win, {
    type: "info",
    message: "The folio command is installed",
    detail: "In a new terminal window, run \"folio .\" to open the current folder, or \"folio notes.md\" to open a file.",
  });
}
