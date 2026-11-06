/**
 * updater.ts — Updates from GitHub Releases (electron-updater), for
 * installed builds only.
 *
 * Shortly after launch, and every few hours, the app checks quietly; a newer
 * version downloads in the background, then the user is offered to restart
 * (or it installs on the next quit). Folio → Check for Updates… (Help → … on
 * Windows / Linux) checks on demand and reports every outcome.
 *
 * Where to look comes from the "publish" settings in package.json, which
 * electron-builder writes into the packaged app. On macOS, updates only
 * install for signed builds.
 */

import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Set while a check the user asked for is running, so its outcome is shown
let manualCheck = false;
let downloaded: UpdateInfo | null = null;

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function show(options: Electron.MessageBoxOptions): Promise<number> {
  const win = focusedWindow();
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response;
}

async function offerRestart(info: UpdateInfo): Promise<void> {
  const response = await show({
    type: "info",
    message: `Folio ${info.version} is ready to install`,
    detail: "Restart now to update, or it installs the next time you quit Folio.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

/** Start checking for updates (installed builds only). */
export function initUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    if (!manualCheck) return;
    manualCheck = false;
    void show({
      type: "info",
      message: `Downloading Folio ${info.version}`,
      detail: "You'll be asked to restart when it's ready.",
    });
  });
  autoUpdater.on("update-not-available", () => {
    if (!manualCheck) return;
    manualCheck = false;
    void show({ type: "info", message: "Folio is up to date", detail: `Version ${app.getVersion()} is the latest.` });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloaded = info;
    void offerRestart(info);
  });
  autoUpdater.on("error", (error) => {
    // Quiet checks fail quietly (offline, GitHub unreachable…)
    if (!manualCheck) return;
    manualCheck = false;
    void show({ type: "warning", message: "Couldn't check for updates", detail: error.message });
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

/** Folio → Check for Updates… */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    await show({ type: "info", message: "Updates are checked in installed builds", detail: "This is a development build." });
    return;
  }
  if (downloaded !== null) {
    await offerRestart(downloaded);
    return;
  }
  manualCheck = true;
  // The outcome arrives as an event above (errors included)
  await autoUpdater.checkForUpdates().catch(() => undefined);
}
