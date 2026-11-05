/**
 * main.ts — Electron main process for the Markdown Previewer desktop app.
 *
 * Replaces the FastAPI backend: the workspace is scanned in-process and the
 * renderer reaches it over IPC (see preload.ts). The React build is served
 * from a privileged `app://` scheme with an index.html fallback, so the
 * frontend's BrowserRouter and /doc/<id>#anchor URLs work unchanged.
 *
 * Environment variables
 * ---------------------
 * VITE_DEV_SERVER_URL
 *     Load the renderer from a running Vite dev server instead of the bundle.
 * MARKDOWN_SKIP_DIRS
 *     Comma-separated folder names to skip (same default as the backend).
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { findDocument, scanWorkspace } from "./scanner";
import type { DocumentContent, DocumentMeta } from "./scanner";
import { loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const APP_NAME = "Markdown Previewer";
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

// Match --color-bg on screen and in print (frontend/src/index.css)
const WINDOW_BACKGROUND_COLOR = "#0d1117";
const PRINT_BACKGROUND_COLOR = "#ffffff";

const DEFAULT_SKIP_DIRS = ".git,node_modules,.venv,__pycache__,.cache";
const SKIP_DIRS: ReadonlySet<string> = new Set(
  (process.env["MARKDOWN_SKIP_DIRS"] ?? DEFAULT_SKIP_DIRS)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

// Inline styles are needed for React `style` props; images may be remote.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
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

let settings: Settings = { workspace: null };
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
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL));
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
    return scanWorkspace(settings.workspace, SKIP_DIRS);
  });

  ipcMain.handle("documents:content", async (event, docId: unknown): Promise<DocumentContent> => {
    assertTrustedSender(event);
    if (typeof docId !== "string") throw new Error("Document id must be a string");
    const result =
      settings.workspace === null ? null : await findDocument(settings.workspace, docId, SKIP_DIRS);
    if (result === null) throw new Error(`Document '${docId}' not found in workspace`);
    return { id: result.meta.id, content: result.content };
  });
}

// ---------------------------------------------------------------------------
// Workspace selection
// ---------------------------------------------------------------------------

function updateWindowTitle(win: BrowserWindow): void {
  const { workspace } = settings;
  win.setTitle(workspace === null ? APP_NAME : `${path.basename(workspace)} — ${APP_NAME}`);
  if (process.platform === "darwin") win.setRepresentedFilename(workspace ?? "");
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

  settings = { ...settings, workspace: folder };
  saveSettings(settings);
  updateWindowTitle(win);
  // Reload at the root so the first document of the new workspace is selected
  await win.loadURL(rendererUrl());
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

  const doc = await findDocument(settings.workspace, docId, SKIP_DIRS);
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

function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as const] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: withWindow(chooseWorkspace) },
        { type: "separator" },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: withWindow((win) => win.webContents.print()) },
        { label: "Export as PDF…", accelerator: "CmdOrCtrl+Shift+E", click: withWindow(exportPdf) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
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
  protocol.handle(APP_SCHEME, handleAppRequest);
  registerIpcHandlers();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
