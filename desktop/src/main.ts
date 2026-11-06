/**
 * main.ts — Electron main process for the Folio desktop app.
 *
 * Replaces the FastAPI backend: the workspace is scanned in-process and the
 * renderer reaches it over IPC (see preload.ts). The React build is served
 * from a privileged `app://` scheme with an index.html fallback, so the
 * frontend's BrowserRouter and /doc/<id>#anchor URLs work unchanged. Images
 * embedded by documents are served under app://bundle/@workspace/<location>
 * (see images.ts).
 *
 * Preferences (workspace, skipped folders, scan depth, theme) live in settings.json;
 * see settings.ts. Recently opened folders live in recent.json; see recent.ts.
 * Files and folders can be opened from the system — command line, Open With,
 * a second launch, a drop on the window — see openPaths.ts and cli.ts.
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

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell, systemPreferences } from "electron";
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
import { serveImage } from "./images";
import { canInstallCommand, installCommand } from "./cli";
import { ensureCustomCss, readCustomCss, watchCustomCss } from "./customCss";
import { editorName, openInEditor } from "./editor";
import { openLinkedFile } from "./files";
import { classifyPath, locationInWorkspace, pathsFromArgv } from "./openPaths";
import { findDocument, scanAttachments, scanWorkspace, stableId } from "./scanner";
import { searchWorkspace } from "./search";
import type { SearchResult } from "./search";
import type { DocumentContent, DocumentMeta, ScanOptions } from "./scanner";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SKIP_DIRS,
  isTheme,
  loadSettings,
  normalizeSettings,
  saveSettings,
  settingsPath,
  watchSettings,
} from "./settings";
import type { Settings, Theme } from "./settings";
import { hasPendingViewState, loadViewState, saveViewState, setViewState, viewStateSnapshot } from "./viewState";
import { checkForUpdatesNow, initUpdater } from "./updater";
import { watchWorkspace } from "./watcher";
import { DEFAULT_SIZE, loadWindowState, trackWindowState } from "./windowState";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const APP_NAME = "Folio";
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;
// Path prefix for workspace images; must match preload.ts
const WORKSPACE_FILES_PREFIX = "/@workspace/";
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
const DEV_SERVER_ORIGIN = DEV_SERVER_URL !== undefined ? new URL(DEV_SERVER_URL).origin : null;

// Match --color-bg of the dark and light themes and print (frontend/src/index.css)
const DARK_BACKGROUND_COLOR = "#1f1f1f";
const LIGHT_BACKGROUND_COLOR = "#ffffff";
const PRINT_BACKGROUND_COLOR = "#ffffff";

/** The window colour behind the page, shown before it paints. */
function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND_COLOR : LIGHT_BACKGROUND_COLOR;
}

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
  if (pathname.startsWith(WORKSPACE_FILES_PREFIX)) {
    let location: string;
    try {
      location = decodeURIComponent(pathname.slice(WORKSPACE_FILES_PREFIX.length));
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return serveImage(settings.workspace, location, new Set(settings.skipDirs));
  }
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
// Document API (IPC) — mirrors GET /api/documents, /api/documents/{id}/content and /api/search
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

  ipcMain.handle("attachments:list", async (event): Promise<string[]> => {
    assertTrustedSender(event);
    if (settings.workspace === null) return [];
    return scanAttachments(settings.workspace, scanOptions());
  });

  ipcMain.handle("documents:search", async (event, query: unknown): Promise<SearchResult[]> => {
    assertTrustedSender(event);
    if (typeof query !== "string") throw new Error("Search query must be a string");
    if (settings.workspace === null) return [];
    return searchWorkspace(settings.workspace, query, scanOptions());
  });

  // The settings panel: read, change, and the actions it offers
  ipcMain.handle("settings:get", (event): SettingsView => {
    assertTrustedSender(event);
    return settingsView();
  });
  ipcMain.handle("settings:set", (event, patch: unknown): SettingsView => {
    assertTrustedSender(event);
    return updateSettings(patch);
  });
  for (const [channel, action] of [
    ["settings:choose-workspace", chooseWorkspace],
    ["settings:open-file", openSettingsFile],
    ["settings:edit-custom-css", editCustomCss],
  ] as const) {
    ipcMain.handle(channel, async (event): Promise<void> => {
      assertTrustedSender(event);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win !== null) await action(win);
    });
  }

  // The user's custom.css: asked for at page load, then pushed on each save
  ipcMain.handle("custom-css:get", (event): string | null => {
    assertTrustedSender(event);
    return readCustomCss();
  });

  // View preferences: all of them once at page load (synchronously, so the
  // first render uses them), then each change
  ipcMain.on("view-state:load", (event) => {
    event.returnValue = isRendererUrl(event.senderFrame?.url ?? "") ? viewStateSnapshot() : {};
  });
  ipcMain.on("view-state:set", (event, key: unknown, value: unknown) => {
    if (isRendererUrl(event.senderFrame?.url ?? "")) setViewState(key, value);
  });

  // A file a document links to ([report](report.pdf)), by workspace location
  ipcMain.handle("workspace:open-file", async (event, location: unknown): Promise<void> => {
    assertTrustedSender(event);
    if (typeof location !== "string") throw new Error("Location must be a string");
    const result = await openLinkedFile(settings.workspace, location, new Set(settings.skipDirs));
    const win = BrowserWindow.fromWebContents(event.sender);
    if (result === "opened" || win === null) return;
    const name = path.basename(location);
    const messages = {
      "not-allowed": [
        `Folio doesn't open ${path.extname(location) || "this kind of"} files from documents`,
        `${name} could run code or isn't a document. Open it from ${process.platform === "darwin" ? "Finder" : "your file manager"} if you trust it.`,
      ],
      "not-found": ["File not found", `${location} isn't in this workspace.`],
      failed: ["Couldn't open the file", `No app could open ${name}.`],
    } as const;
    const [message, detail] = messages[result];
    await dialog.showMessageBox(win, { type: "warning", message, detail });
  });

  // A file or folder dropped on the window (the renderer resolves its path)
  ipcMain.handle("workspace:open-path", (event, target: unknown): void => {
    assertTrustedSender(event);
    if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("Path must be absolute");
    requestOpen([target]);
  });

  // The header's Open in Editor button: its label, and the action
  ipcMain.handle("editor:name", (event): string | null => {
    assertTrustedSender(event);
    return editorName(settings.editor);
  });
  ipcMain.handle("editor:open", async (event): Promise<void> => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== null) await openCurrentInEditor(win);
  });

  // The renderer asks once on load; later changes are pushed (see applyTheme)
  ipcMain.handle("theme:get", (event): Theme => {
    assertTrustedSender(event);
    return settings.theme;
  });

  // The header's display options menu
  ipcMain.handle("theme:set", (event, theme: unknown): void => {
    assertTrustedSender(event);
    if (!isTheme(theme)) throw new Error("Theme must be system, light or dark");
    setTheme(theme);
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

/**
 * Reload at the root so the first document of the new workspace is selected,
 * or at `docId` when a particular document was asked for.
 */
async function loadWorkspaceRoot(win: BrowserWindow, docId?: string): Promise<void> {
  const url = docId === undefined ? rendererUrl() : new URL(`doc/${encodeURIComponent(docId)}`, rendererUrl()).href;
  await win.loadURL(url);
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

async function openWorkspace(win: BrowserWindow, folder: string, docId?: string): Promise<void> {
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
  broadcastSettings();
  rememberWorkspace(folder);
  updateWindowTitle(win);
  await loadWorkspaceRoot(win, docId);
}

// ---------------------------------------------------------------------------
// Opening files and folders from the system
// ---------------------------------------------------------------------------

// Paths that arrived before the window could take them (launch, no window)
let pendingPaths: string[] = [];
let windowReady = false;

/**
 * Open a folder as the workspace, or a markdown file: in place when it's in
 * the current workspace (keeping history), otherwise with its folder as
 * the new workspace.
 */
async function openPath(win: BrowserWindow, target: string): Promise<void> {
  const kind = await classifyPath(target);
  if (kind === "folder") {
    await openWorkspace(win, target);
    return;
  }
  if (kind !== "markdown") {
    await dialog.showMessageBox(win, {
      type: "warning",
      message: kind === "missing" ? "File not found" : "Folio opens Markdown files and folders",
      detail: kind === "missing" ? target : `${path.basename(target)} isn't a .md or .markdown file.`,
    });
    return;
  }

  if (settings.workspace !== null) {
    const location = await locationInWorkspace(target, settings.workspace);
    // Not listed when inside a skipped folder or below the depth cap
    const doc = location === null ? null : await findDocument(settings.workspace, stableId(location), scanOptions());
    if (doc !== null) {
      // Navigate as a user action: Chromium skips history entries a page adds
      // without one when going Back, and Back should return to where you were.
      // The renderer handles the event in App.tsx.
      const detail = JSON.stringify(doc.meta.id);
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent("folio:open-document", { detail: ${detail} }))`,
        true,
      );
      return;
    }
  }
  await openWorkspace(win, path.dirname(target), stableId(path.basename(target)));
}

/** Open `paths` in the main window (the last one wins), creating it if needed. */
function requestOpen(paths: readonly string[]): void {
  if (paths.length === 0) return;
  if (!app.isReady() || mainWindow === null || !windowReady) {
    pendingPaths.push(...paths);
    if (app.isReady() && mainWindow === null) mainWindow = createWindow();
    return;
  }
  const win = mainWindow;
  if (win.isMinimized()) win.restore();
  win.focus();
  void (async () => {
    for (const target of paths) await openPath(win, target);
  })();
}

/** Called once the window has loaded: open what was asked for, if anything. */
function takePendingPaths(): string[] {
  const paths = pendingPaths;
  pendingPaths = [];
  return paths;
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
// Appearance
// ---------------------------------------------------------------------------

/**
 * Apply the theme setting. nativeTheme drives the page's
 * prefers-color-scheme, which the frontend resolves "system" with, along with
 * native scrollbars, menus and the macOS title bar. The renderer is told the
 * setting itself so its display options menu shows the current choice.
 */
function applyTheme(): void {
  nativeTheme.themeSource = settings.theme;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("theme:changed", settings.theme);
  }
}

/** View → Appearance or the display options menu: save, apply, and update the menu. */
function setTheme(theme: Theme): void {
  if (theme === settings.theme) return;
  settings = { ...settings, theme };
  saveSettings(settings);
  applyTheme();
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

/** What the settings panel shows and edits (theme has its own calls; see applyTheme). */
interface SettingsView {
  workspace: string | null;
  skipDirs: string[];
  maxDepth: number | null;
  editor: string | null;
  defaultSkipDirs: readonly string[];
  /** The editor used when `editor` is null, if one is installed (macOS). */
  detectedEditor: string | null;
}

function settingsView(): SettingsView {
  return {
    workspace: settings.workspace,
    skipDirs: settings.skipDirs,
    maxDepth: settings.maxDepth,
    editor: settings.editor,
    defaultSkipDirs: DEFAULT_SKIP_DIRS,
    detectedEditor: editorName(null),
  };
}

/** Tell open settings panels what the settings are now. */
function broadcastSettings(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("settings:changed", settingsView());
}

/**
 * Apply new settings — edits to settings.json made while the app runs, and
 * changes from the settings panel. Our own saves come back here unchanged.
 */
function applySettings(next: Settings): void {
  const workspaceChanged = next.workspace !== settings.workspace;
  const scanChanged =
    next.maxDepth !== settings.maxDepth || next.skipDirs.join("\0") !== settings.skipDirs.join("\0");
  const themeChanged = next.theme !== settings.theme;
  const editorChanged = next.editor !== settings.editor;
  if (!workspaceChanged && !scanChanged && !themeChanged && !editorChanged) return;

  settings = next;
  if (themeChanged) applyTheme();
  if (themeChanged || editorChanged) Menu.setApplicationMenu(buildMenu());
  if (editorChanged) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("editor:changed", editorName(settings.editor));
    }
  }
  if (workspaceChanged || scanChanged) {
    restartWatcher();
    if (workspaceChanged && next.workspace !== null) rememberWorkspace(next.workspace);
    for (const win of BrowserWindow.getAllWindows()) {
      updateWindowTitle(win);
      // A new workspace starts at its first document
      if (workspaceChanged) void loadWorkspaceRoot(win);
    }
    // New scan options: the open page refreshes its list, like after a file
    // change (no reload, so an open settings panel stays open)
    if (!workspaceChanged) notifyWorkspaceChanged();
  }
  broadcastSettings();
}

/** A change from the settings panel: only the fields it edits, validated like settings.json. */
function updateSettings(patch: unknown): SettingsView {
  if (patch === null || typeof patch !== "object") return settingsView();
  const changes = patch as Record<string, unknown>;
  const editable = ["skipDirs", "maxDepth", "editor"].filter((key) => key in changes);
  const next = normalizeSettings({ ...settings, ...Object.fromEntries(editable.map((key) => [key, changes[key]])) });
  saveSettings(next);
  applySettings(next);
  return settingsView();
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

/** The file of the document shown in `win`, or null when none is. */
async function currentDocPath(win: BrowserWindow): Promise<string | null> {
  const docId = currentDocId(win);
  if (docId === null || settings.workspace === null) return null;
  const doc = await findDocument(settings.workspace, docId, scanOptions());
  return doc === null ? null : path.join(settings.workspace, doc.meta.location);
}

/** File → Open in Editor (and the header button). */
async function openCurrentInEditor(win: BrowserWindow): Promise<void> {
  const file = await currentDocPath(win);
  if (file === null) return;
  try {
    await openInEditor(file, settings.editor);
  } catch (error) {
    const name = editorName(settings.editor);
    await dialog.showMessageBox(win, {
      type: "warning",
      message: name === null ? "Couldn't open the document in an editor" : `Couldn't open the document in ${name}`,
      detail:
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        `Choose the editor with "editor" in settings.json (Settings…): ` +
        (process.platform === "darwin" ? `an app name, e.g. "Visual Studio Code".` : `a command, e.g. "code".`),
    });
  }
}

/** View → Edit Custom CSS…: create custom.css from its template if needed, and open it. */
async function editCustomCss(win: BrowserWindow): Promise<void> {
  const file = ensureCustomCss();
  try {
    await openInEditor(file, settings.editor);
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Couldn't open custom.css",
      detail: `${error instanceof Error ? error.message : String(error)}\n\nEdit it at:\n${file}`,
    });
  }
}

/** File → Reveal in Finder / Show in Folder. */
async function revealCurrent(win: BrowserWindow): Promise<void> {
  const file = await currentDocPath(win);
  if (file !== null) shell.showItemInFolder(file);
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
    win.setBackgroundColor(windowBackgroundColor());
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
    // The page shows its settings panel (which links to settings.json)
    click: withWindow((win) => win.webContents.send("settings:show")),
  };
  const template: MenuItemConstructorOptions[] = [
    // macOS keeps Settings… in the app menu; elsewhere it goes under File
    ...(isMac
      ? [
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              { label: "Check for Updates…", click: () => void checkForUpdatesNow() },
              { type: "separator" },
              settingsItem,
              ...(canInstallCommand()
                ? [{ label: "Install 'folio' Command in PATH…", click: withWindow(installCommand) }]
                : []),
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
        {
          label: `Open in ${editorName(settings.editor) ?? "Editor"}`,
          accelerator: "CmdOrCtrl+E",
          click: withWindow(openCurrentInEditor),
        },
        {
          label: isMac ? "Reveal in Finder" : "Show in Folder",
          accelerator: isMac ? "Alt+Cmd+R" : "Shift+Alt+R",
          click: withWindow(revealCurrent),
        },
        { type: "separator" },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: withWindow((win) => win.webContents.print()) },
        { label: "Export as PDF…", accelerator: "CmdOrCtrl+Shift+E", click: withWindow(exportPdf) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        // A viewer has nothing to undo, cut or paste in the document, but the
        // search box, find bar and settings fields do: on macOS text fields
        // only get ⌘Z / ⌘X / ⌘V through the Edit menu, so these stay as
        // hidden items whose shortcuts still work
        { role: "undo", visible: false },
        { role: "redo", visible: false },
        { role: "cut", visible: false },
        { role: "paste", visible: false },
        { role: "delete", visible: false },
        { role: "copy" },
        { role: "selectAll" },
        { type: "separator" },
        // The page handles these keys itself (find bar, sidebar search); the
        // menu shows them and works by click, without taking the keys
        ...(
          [
            ["Find…", "CmdOrCtrl+F", "open"],
            ["Find Next", isMac ? "Cmd+G" : "F3", "next"],
            ["Find Previous", isMac ? "Shift+Cmd+G" : "Shift+F3", "previous"],
            ["Search Document Text…", "Shift+CmdOrCtrl+F", "search-text"],
          ] as const
        ).map(
          ([label, accelerator, command]): MenuItemConstructorOptions => ({
            label,
            accelerator,
            registerAccelerator: false,
            click: withWindow((win) => win.webContents.send("find:command", command)),
          }),
        ),
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Appearance",
          submenu: (
            [
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const
          ).map(
            ([theme, label]): MenuItemConstructorOptions => ({
              label,
              type: "radio",
              checked: settings.theme === theme,
              click: () => setTheme(theme),
            }),
          ),
        },
        { label: "Edit Custom CSS…", click: withWindow(editCustomCss) },
        { type: "separator" },
        // The rest of Electron's default View menu
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
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
    // macOS has Check for Updates… in the app menu
    ...(isMac ? [] : [{ role: "help", submenu: [{ label: "Check for Updates…", click: () => void checkForUpdatesNow() }] } satisfies MenuItemConstructorOptions]),
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): BrowserWindow {
  // Where the window was last time, if that's still on a display
  const saved = loadWindowState();
  const win = new BrowserWindow({
    ...(saved === null ? DEFAULT_SIZE : saved.bounds),
    minWidth: 640,
    minHeight: 400,
    title: APP_NAME,
    backgroundColor: windowBackgroundColor(),
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
  win.once("ready-to-show", () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });
  trackWindowState(win);

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

  // A file or folder asked for at launch replaces the first-run folder prompt
  win.webContents.once("did-finish-load", () => {
    windowReady = true;
    const paths = takePendingPaths();
    if (paths.length > 0) requestOpen(paths);
    else if (settings.workspace === null) void chooseWorkspace(win);
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      windowReady = false;
    }
  });
  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.setName(APP_NAME);

// macOS adds Start Dictation… and Emoji & Symbols to any menu titled "Edit";
// a document viewer has no use for them
if (process.platform === "darwin") {
  systemPreferences.setUserDefault("NSDisabledDictationMenuItem", "boolean", true);
  systemPreferences.setUserDefault("NSDisabledCharacterPaletteMenuItem", "boolean", true);
}

// One app instance: launching it again (e.g. `Folio.exe notes.md`) hands
// the paths to the running one instead of opening a second window
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const paths = pathsFromArgv(argv, workingDirectory, app.isPackaged);
    if (paths.length > 0) requestOpen(paths);
    else if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// macOS: Finder (double-click, Open With, drop on the Dock icon) and
// `open -a Folio …`. Can arrive before `ready` when it launches the app.
app.on("open-file", (event, target) => {
  event.preventDefault();
  requestOpen([target]);
});

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  pendingPaths.push(...pathsFromArgv(process.argv, process.cwd(), app.isPackaged));
  settings = loadSettings();
  loadViewState();
  applyTheme();
  // The OS switching light/dark (or our own setting) repaints the windows' background
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackgroundColor());
  });
  recentWorkspaces = loadRecentWorkspaces();
  // Also records the workspace of installs that predate the recent list
  if (settings.workspace !== null && recentWorkspaces[0] !== settings.workspace) {
    recentWorkspaces = addRecentWorkspace(recentWorkspaces, settings.workspace);
  }
  protocol.handle(APP_SCHEME, handleAppRequest);
  // The app needs no camera, microphone, notifications, geolocation, …
  // Only writing to the clipboard, for code blocks' copy buttons.
  const allowed = (permission: string) => permission === "clipboard-sanitized-write";
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => allowed(permission));
  registerIpcHandlers();
  watchSettings(applySettings);
  watchCustomCss((css) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("custom-css:changed", css);
  });
  restartWatcher();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();
  initUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

// View preferences are saved with a short delay: write what's pending
app.on("before-quit", () => {
  if (hasPendingViewState()) saveViewState();
});

// A termination signal (logout, a process manager) quits like ⌘Q, so the
// save above runs too
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => app.quit());
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
