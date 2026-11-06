/**
 * editor.ts — Opens a document in the user's editor (File → Open in Editor).
 *
 * The "editor" setting picks it:
 *   macOS        an app name, opened with `open -a` ("Visual Studio Code",
 *                "Cursor", "Typora"…); GUI apps don't get the shell's PATH,
 *                so app names are more reliable than commands
 *   Windows/Linux a command on the PATH ("code", "subl", "gedit"…)
 *
 * Without it, macOS uses the first common editor that's installed, else
 * the default text editor; Windows and Linux use the default app for the
 * file type.
 */

import { shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Checked in order when no editor is set (macOS)
const MAC_EDITORS = [
  "Visual Studio Code",
  "Cursor",
  "Zed",
  "Windsurf",
  "Sublime Text",
  "BBEdit",
  "Nova",
  "Typora",
  "iA Writer",
  "MarkText",
];

let detectedMacEditor: string | null | undefined;

/** The first editor from MAC_EDITORS installed in /Applications or ~/Applications. */
function detectMacEditor(): string | null {
  if (detectedMacEditor === undefined) {
    const dirs = ["/Applications", path.join(os.homedir(), "Applications")];
    detectedMacEditor =
      MAC_EDITORS.find((name) => dirs.some((dir) => existsSync(path.join(dir, `${name}.app`)))) ?? null;
  }
  return detectedMacEditor;
}

/** The editor's name for menus and tooltips, or null for "the default app". */
export function editorName(setting: string | null): string | null {
  if (setting !== null) return setting;
  return process.platform === "darwin" ? detectMacEditor() : null;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}

/** Start `command file` without waiting for it (an editor keeps running). */
function launch(command: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Windows commands like `code` are .cmd scripts, which need a shell; the
    // shell then needs the path quoted
    const isWindows = process.platform === "win32";
    const child = spawn(command, [isWindows ? `"${file}"` : file], {
      detached: true,
      stdio: "ignore",
      shell: isWindows,
    });
    child.once("error", (error) => reject(new Error(`Couldn't run "${command}": ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** Open `file` in the editor; rejects with a message for the user. */
export async function openInEditor(file: string, setting: string | null): Promise<void> {
  if (process.platform === "darwin") {
    const app = editorName(setting);
    // -t: the default text editor
    await run("open", app === null ? ["-t", file] : ["-a", app, file]);
    return;
  }
  if (setting !== null) {
    await launch(setting, file);
    return;
  }
  const error = await shell.openPath(file);
  if (error) throw new Error(error);
}
