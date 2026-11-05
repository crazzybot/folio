/**
 * main.ts — Electron main process for the Markdown Previewer desktop app.
 *
 * Replaces the FastAPI backend: the workspace is scanned in-process and the
 * renderer reaches it over IPC (see preload.ts). The React build is served
 * from a privileged `app://` scheme with an index.html fallback, so the
 * frontend's BrowserRouter and /doc/<id>#anchor URLs work unchanged.
 *
 * Preferences (workspace, skipped folders, scan depth) live in settings.json;
 * see settings.ts. Recently opened folders live in recent.json; see recent.ts.
 * The workspace is watched for markdown changes (see watcher.ts), which the
 * renderer is told about so it can refresh without a reload.
 *
 * Environment variables
 * ---------------------
 * VITE_DEV_SERVER_URL
 *     Load the renderer from a running Vite dev server instead of the bundle.
 *     Ignored in packaged builds, so it can't hand the document API to an
 *     arbitrary page.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, WebContents } from "electron";
import { existsSync, promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addRecentWorkspace,
  clearRecentWorkspaces,
  loadRecentWorkspaces,
  removeRecentWorkspace,
} from "./recent";
import { findDocument, scanWorkspace } from "./scanner";
import type { DocumentContent, DocumentMeta, ScanOptions } from "./scanner";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsPath, watchSettings } from "./settings";
import type { Settings } from "./settings";
import { watchWorkspace } from "./watcher";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const APP_NAME = "Markdown Previewer";
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
const DEV_SERVER_ORIGIN = DEV_SERVER_URL !== undefined ? new URL(DEV_SERVER_URL).origin : null;

// Match --color-bg on screen and in print (frontend/src/index.css)
const WINDOW_BACKGROUND_COLOR = "#1f1f1f";
const PRINT_BACKGROUND_COLOR = "#ffffff";

// Inline styles are needed for React `style` props; images may be remote.
// Documents are sanitized before rendering (see MarkdownViewer.tsx); this
// policy is the second layer: no inline scripts, frames, plugins, forms or
// <base> rewriting even if markup slipped through.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let recentWorkspaces: string[] = [];

function scanOptions(): ScanOptions {
  return { skipDirs: new Set(settings.skipDirs), maxDepth: settings.maxDepth };
}
let mainWindow: BrowserWindow | null = null;

// Must run before `ready`: lets app:// behave like https (fetch, storage, history).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// ---------------------------------------------------------------------------
// Renderer bundle (app:// scheme)
// ---------------------------------------------------------------------------

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Serve renderer files, falling back to index.html for client-side routes. */
async function handleAppRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const requested = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)));
  const insideBundle = requested.startsWith(RENDERER_DIR + path.sep);

  let filePath: string;
  if (insideBundle && isFile(requested)) {
    filePath = requested;
  } else if (insideBundle && path.extname(requested) !== "") {
    // A missing asset — don't mask it with index.html
    return new Response("Not found", { status: 404 });
  } else {
    filePath = path.join(RENDERER_DIR, "index.html");
  }

  const body = await fs.readFile(filePath);
  return new Response(body, {
    headers: {
      "content-type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "content-security-policy": CONTENT_SECURITY_POLICY,
    },
  });
}

function rendererUrl(): string {
  return DEV_SERVER_URL ?? `${APP_ORIGIN}/`;
}

function isRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Node reports custom-scheme origins as "null", so compare scheme + host
    if (parsed.protocol === `${APP_SCHEME}:`) return `${parsed.protocol}//${parsed.host}` === APP_ORIGIN;
    return parsed.origin === DEV_SERVER_ORIGIN;
  } catch {
    return false;
  }
}

/** Open http(s)/mailto links in the default browser; ignore anything else. */
function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

// ---------------------------------------------------------------------------
// Document API (IPC) — mirrors GET /api/documents and /api/documents/{id}/content
// ---------------------------------------------------------------------------

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? "";
  if (!isRendererUrl(url)) throw new Error(`Untrusted IPC sender: ${url}`);
}

function registerIpcHandlers(): void {
  ipcMain.handle("documents:list", async (event): Promise<DocumentMeta[]> => {
    assertTrustedSender(event);
    if (settings.workspace === null) return [];
    return scanWorkspace(settings.workspace, scanOptions());
  });

  ipcMain.handle("documents:content", async (event, docId: unknown): Promise<DocumentContent> => {
    assertTrustedSender(event);
    if (typeof docId !== "string") throw new Error("Document id must be a string");
    const result =
      settings.workspace === null ? null : await findDocument(settings.workspace, docId, scanOptions());
    if (result === null) throw new Error(`Document '${docId}' not found in workspace`);
    return { id: result.meta.id, content: result.content };
  });

  // The renderer asks once on load; later changes are pushed (see updateNavigationState)
  ipcMain.handle("navigation:state", (event): NavigationState => {
    assertTrustedSender(event);
    return navigationState(event.sender);
  });
}

// ---------------------------------------------------------------------------
// Back / forward navigation
// ---------------------------------------------------------------------------

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

function navigationState(contents: WebContents): NavigationState {
  const { navigationHistory } = contents;
  return { canGoBack: navigationHistory.canGoBack(), canGoForward: navigationHistory.canGoForward() };
}

/** Sync the Go menu and the renderer's back/forward buttons with the window's history. */
function updateNavigationState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const state = navigationState(win.webContents);
  win.webContents.send("navigation:state", state);

  const menu = Menu.getApplicationMenu();
  const back = menu?.getMenuItemById("go-back");
  const forward = menu?.getMenuItemById("go-forward");
  if (back) back.enabled = state.canGoBack;
  if (forward) forward.enabled = state.canGoForward;
}

function goBack(win: BrowserWindow): void {
  if (win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
}

function goForward(win: BrowserWindow): void {
  if (win.webContents.navigationHistory.canGoForward()) win.webContents.navigationHistory.goForward();
}

// ---------------------------------------------------------------------------
// Live reload
// ---------------------------------------------------------------------------

/** Tell every window that markdown files in the workspace changed. */
function notifyWorkspaceChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("workspace:changed");
  }
}

/** (Re)start watching the current workspace with the current skipped folders. */
function restartWatcher(): void {
  watchWorkspace(settings.workspace, new Set(settings.skipDirs), notifyWorkspaceChanged);
}

// ---------------------------------------------------------------------------
// Workspace selection
// ---------------------------------------------------------------------------

function updateWindowTitle(win: BrowserWindow): void {
  const { workspace } = settings;
  win.setTitle(workspace === null ? APP_NAME : `${path.basename(workspace)} — ${APP_NAME}`);
  if (process.platform === "darwin") win.setRepresentedFilename(workspace ?? "");
}

/** Reload at the root so the first document of the new workspace is selected. */
async function loadWorkspaceRoot(win: BrowserWindow): Promise<void> {
  await win.loadURL(rendererUrl());
  // Documents of the previous workspace aren't reachable any more, so Back
  // must not lead to them
  win.webContents.navigationHistory.clear();
  updateNavigationState(win);
}

/** Put `folder` at the top of File → Open Recent. */
function rememberWorkspace(folder: string): void {
  recentWorkspaces = addRecentWorkspace(recentWorkspaces, folder);
  Menu.setApplicationMenu(buildMenu());
}

async function openWorkspace(win: BrowserWindow, folder: string): Promise<void> {
  if (!existsSync(folder)) {
    recentWorkspaces = removeRecentWorkspace(recentWorkspaces, folder);
    Menu.setApplicationMenu(buildMenu());
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Folder not found",
      detail: `${folder}\n\nIt may have been moved or deleted, and has been removed from the recent list.`,
    });
    return;
  }

  settings = { ...settings, workspace: folder };
  saveSettings(settings);
  restartWatcher();
  rememberWorkspace(folder);
  updateWindowTitle(win);
  await loadWorkspaceRoot(win);
}

async function chooseWorkspace(win: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(win, {
    title: "Open Markdown Folder",
    buttonLabel: "Open",
    defaultPath: settings.workspace ?? app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  const folder = result.filePaths[0];
  if (result.canceled || folder === undefined) return;
  await openWorkspace(win, folder);
}

function clearRecent(): void {
  recentWorkspaces = clearRecentWorkspaces(settings.workspace);
  Menu.setApplicationMenu(buildMenu());
}

// ---------------------------------------------------------------------------
// Settings file
// ---------------------------------------------------------------------------

/** Open settings.json in the default editor, writing it out first if needed. */
async function openSettingsFile(win: BrowserWindow): Promise<void> {
  // Always write the current values so every option is visible to edit
  saveSettings(settings);
  const error = await shell.openPath(settingsPath());
  if (error) {
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Couldn't open the settings file",
      detail: `${error}\n\nEdit it manually at:\n${settingsPath()}`,
    });
  }
}

/** Apply settings.json edits made while the app is running. */
function applySettings(next: Settings): void {
  const workspaceChanged = next.workspace !== settings.workspace;
  const scanChanged =
    next.maxDepth !== settings.maxDepth || next.skipDirs.join("\0") !== settings.skipDirs.join("\0");
  // Our own saves (Open Folder, Settings…) come back here unchanged
  if (!workspaceChanged && !scanChanged) return;

  settings = next;
  restartWatcher();
  if (workspaceChanged && next.workspace !== null) rememberWorkspace(next.workspace);
  for (const win of BrowserWindow.getAllWindows()) {
    updateWindowTitle(win);
    // A new workspace starts at its first document; otherwise reload the
    // current route so the document list reflects the new scan options
    if (workspaceChanged) void loadWorkspaceRoot(win);
    else win.webContents.reload();
  }
}

// ---------------------------------------------------------------------------
// Printing / PDF export
// ---------------------------------------------------------------------------

/** The document id from the current /doc/<id> route, if any. */
function currentDocId(win: BrowserWindow): string | null {
  const { pathname } = new URL(win.webContents.getURL());
  const match = /^\/doc\/([^/]+)/.exec(pathname);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

async function exportPdf(win: BrowserWindow): Promise<void> {
  const docId = currentDocId(win);
  if (docId === null || settings.workspace === null) return;

  const doc = await findDocument(settings.workspace, docId, scanOptions());
  const stem = doc === null ? "document" : path.parse(doc.meta.filename).name;

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export as PDF",
    defaultPath: path.join(app.getPath("documents"), `${stem}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || filePath === undefined) return;

  // Uses the same @media print / @page rules as the browser print dialog.
  // With printBackground the @page margins take the window's background
  // colour, so switch it to the print palette's white for the export.
  win.setBackgroundColor(PRINT_BACKGROUND_COLOR);
  try {
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(filePath, data);
  } finally {
    win.setBackgroundColor(WINDOW_BACKGROUND_COLOR);
  }
}

// ---------------------------------------------------------------------------
// Window & menu
// ---------------------------------------------------------------------------

function withWindow(action: (win: BrowserWindow) => unknown): () => void {
  return () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (win !== null) void action(win);
  };
}

/** A folder path for a menu label: "~" for the home folder, "&" not taken as a mnemonic. */
function folderLabel(folder: string): string {
  const home = os.homedir();
  const label = folder === home || folder.startsWith(home + path.sep) ? "~" + folder.slice(home.length) : folder;
  return process.platform === "win32" ? label.replaceAll("&", "&&") : label;
}

/** File → Open Recent: other recently opened folders (the current one is already open). */
function recentMenu(): MenuItemConstructorOptions[] {
  const folders = recentWorkspaces.filter((folder) => folder !== settings.workspace);
  return [
    ...folders.map(
      (folder): MenuItemConstructorOptions => ({
        label: folderLabel(folder),
        click: withWindow((win) => openWorkspace(win, folder)),
      }),
    ),
    ...(folders.length > 0 ? [{ type: "separator" } satisfies MenuItemConstructorOptions] : []),
    { label: "Clear Recently Opened", enabled: folders.length > 0, click: clearRecent },
  ];
}

function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const navigation = win !== null && !win.isDestroyed() ? navigationState(win.webContents) : null;
  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: withWindow(openSettingsFile),
  };
  const template: MenuItemConstructorOptions[] = [
    // macOS keeps Settings… in the app menu; elsewhere it goes under File
    ...(isMac
      ? [
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: withWindow(chooseWorkspace) },
        { label: "Open Recent", submenu: recentMenu() },
        ...(isMac ? [] : [settingsItem]),
        { type: "separator" },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: withWindow((win) => win.webContents.print()) },
        { label: "Export as PDF…", accelerator: "CmdOrCtrl+Shift+E", click: withWindow(exportPdf) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Go",
      submenu: [
        {
          id: "go-back",
          label: "Back",
          accelerator: isMac ? "Cmd+[" : "Alt+Left",
          enabled: navigation?.canGoBack ?? false,
          click: withWindow(goBack),
        },
        {
          id: "go-forward",
          label: "Forward",
          accelerator: isMac ? "Cmd+]" : "Alt+Right",
          enabled: navigation?.canGoForward ?? false,
          click: withWindow(goForward),
        },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 400,
    title: APP_NAME,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    show: false,
    // macOS: hide the title bar and inset the window buttons into the app's
    // 35px header row (--header-height), as VS Code does
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 13, y: 11 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Keep the workspace name in the title instead of index.html's <title>
  win.on("page-title-updated", (event) => event.preventDefault());
  win.once("ready-to-show", () => win.show());

  // Links in documents open in the browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  // Router pushes (document switches, anchors) are in-page navigations
  win.webContents.on("did-navigate", () => updateNavigationState(win));
  win.webContents.on("did-navigate-in-page", () => updateNavigationState(win));
  win.on("focus", () => updateNavigationState(win));

  updateWindowTitle(win);
  void win.loadURL(rendererUrl());

  if (settings.workspace === null) {
    win.webContents.once("did-finish-load", () => void chooseWorkspace(win));
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.setName(APP_NAME);

void app.whenReady().then(() => {
  settings = loadSettings();
  recentWorkspaces = loadRecentWorkspaces();
  // Also records the workspace of installs that predate the recent list
  if (settings.workspace !== null && recentWorkspaces[0] !== settings.workspace) {
    recentWorkspaces = addRecentWorkspace(recentWorkspaces, settings.workspace);
  }
  protocol.handle(APP_SCHEME, handleAppRequest);
  // The app needs no camera, microphone, notifications, geolocation, …
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpcHandlers();
  watchSettings(applySettings);
  restartWatcher();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
