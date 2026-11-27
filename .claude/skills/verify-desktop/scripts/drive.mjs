// Helpers for driving the dev build that launch.sh started. Import it from
// a step script in the scratch folder:
//
//   import { connect, shot } from "<repo>/.claude/skills/verify-desktop/scripts/drive.mjs";
//   const { browser, page } = await connect();
//   await page.click('[aria-label="Find"]');
//   await shot("find-open");
//   await browser.disconnect();
//
// puppeteer-core comes from scripts/media/ (`npm ci` there once).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const require = createRequire(path.join(repo, "scripts/media/package.json"));
const puppeteer = require("puppeteer-core");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cdpPort = Number(process.env.FOLIO_CDP_PORT ?? 9333);

/**
 * The app's main window (not the agent panel's agent.html). Waits for the
 * document list, so steps start on a loaded app.
 */
export async function connect(port = cdpPort) {
  cdpPort = port;
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    const pages = await browser.pages();
    page = pages.find((p) => !p.url().includes("agent.html") && p.url().startsWith("app://"));
    if (!page) await sleep(250);
  }
  if (!page) throw new Error(`No app:// window on port ${port}: ${(await browser.pages()).map((p) => p.url()).join(", ")}`);
  await page.waitForSelector('[aria-label="Document list"]', { timeout: 15000 });
  return { browser, page };
}

/**
 * A screenshot of the driven app's main window only, never a screen region:
 * a region capture takes whatever is on top of the app, such as the user's
 * browser. The window is the one owned by the process listening on the CDP
 * port; owner and title can't tell it apart from the user's own dev build.
 * Saved as <dir>/<name>.png (dir: FOLIO_SHOTS, else ./shots).
 */
export async function shot(name, dir = process.env.FOLIO_SHOTS ?? "shots") {
  mkdirSync(dir, { recursive: true });
  const helper = path.join(dir, ".window-id");
  if (!existsSync(helper)) execFileSync("swiftc", ["-O", path.join(here, "window-id.swift"), "-o", helper]);
  const pid = execFileSync("lsof", ["-nP", `-iTCP:${cdpPort}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim().split("\n")[0];
  // Let the last click or animation settle
  await sleep(300);
  let id;
  try {
    id = execFileSync(helper, [pid], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`No on-screen window for process ${pid} (minimized, or on another Space?)`);
  }
  const file = path.resolve(dir, `${name}.png`);
  execFileSync("screencapture", ["-x", "-o", "-l", id, file]);
  return file;
}
