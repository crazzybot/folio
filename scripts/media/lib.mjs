// Shared puppeteer helpers for the recording and still scripts, against the
// demo build (`npm run dev:demo` in frontend/): documents from its bundle.json,
// marks in the page's localStorage.
import puppeteer from "puppeteer-core";

export const BASE = "http://localhost:3000";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The demo keeps its routes in the hash
export const docUrl = (id) => `${BASE}/#/doc/${encodeURIComponent(id)}`;
// frontend/src/demo/marks.ts
const MARKS_KEY = "folio.demo.marks";
const MARKS_VERSION = 1;

export async function bundle() {
  const r = await fetch(`${BASE}/bundle.json`);
  if (!r.ok) throw new Error(`${BASE}/bundle.json: ${r.status} (is \`npm run dev:demo\` running?)`);
  return r.json();
}
export async function docs() {
  return (await bundle()).documents;
}
export async function idOf(loc) {
  const doc = (await docs()).find((d) => d.location === loc);
  if (!doc) throw new Error(`no document ${loc} in the bundle`);
  return doc.id;
}

// One profile for every script, so the marks a recording makes are there
// for the stills taken after it
export function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    userDataDir: process.env.FOLIO_DEMO_PROFILE ?? "profile",
  });
}

// Every page: no demo banner, so the app looks as it does on the desktop
export async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = 'div[role="note"]:has(> span > a[href="../"]) { display: none !important; }';
      document.head.append(style);
    });
  });
  return page;
}

// View settings from a clean slate. The marks stay, unless `marks` is given:
// then they're the bundle's seed marks, with `marks` (by document id: fields
// of frontend/src/demo/marks.ts's StoredMarks) replacing theirs.
// Set on bundle.json, a page of the same origin that isn't the app, so the
// app reads them when it opens.
export async function setPrefs(page, prefs, marks) {
  let documents = null;
  if (marks) {
    documents = (await bundle()).seedMarks;
    for (const [id, changes] of Object.entries(marks)) {
      documents[id] = { bookmarks: [], highlights: [], ...documents[id], ...changes };
    }
  }
  await page.goto(`${BASE}/bundle.json`);
  await page.evaluate((p, key, saved) => {
    for (const k of Object.keys(localStorage)) if (k !== key) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
    if (saved.documents) localStorage.setItem(key, JSON.stringify(saved));
  }, prefs, MARKS_KEY, { version: MARKS_VERSION, documents });
}

// Mouse helpers with eased movement, for a natural-looking recording
export function mouse(page, out) {
  let pos = { x: 640, y: 600 };
  async function moveTo(x, y, ms) {
    const d = Math.hypot(x - pos.x, y - pos.y);
    const dur = ms ?? Math.min(900, 250 + d * 0.9);
    const steps = Math.max(8, Math.round(dur / 16));
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(dur / steps);
    }
    pos = { x, y };
  }
  async function center(selector) {
    // The first visible match: the narrow-window drawers keep hidden copies of some controls
    const el = await page.waitForFunction(
      (s) => [...document.querySelectorAll(s)].find((e) => e.checkVisibility() && e.getClientRects().length > 0),
      { timeout: 5000 },
      selector,
    ).catch(async (e) => {
      await page.screenshot({ path: `${out}/fail.png` });
      throw new Error(`${selector}: ${e.message}`);
    });
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  async function click(selector, pause = 350) {
    const c = await center(selector);
    await moveTo(c.x, c.y);
    await sleep(150);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(pause);
  }
  async function typeSlowly(text) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(ch === " " ? 45 : 28);
    }
  }
  // Where `text` starts and ends in the rendered document
  function textEnds(text) {
    return page.evaluate((text) => {
      const article = document.querySelector("article.folio-document");
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.data.indexOf(text);
        if (at < 0) continue;
        n.parentElement.scrollIntoView({ block: "nearest" });
        const r = document.createRange();
        r.setStart(n, at); r.setEnd(n, at + 1);
        const a = r.getBoundingClientRect();
        r.setStart(n, at + text.length - 1); r.setEnd(n, at + text.length);
        const b = r.getBoundingClientRect();
        return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 0.5, y2: b.top + b.height / 2 };
      }
      return null;
    }, text);
  }
  async function scrollBy(dy, ms = 900) {
    const steps = Math.round(ms / 30);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel({ deltaY: dy / steps });
      await sleep(30);
    }
    await sleep(250);
  }
  async function select(text, ms = 650) {
    const e = await textEnds(text);
    if (!e) throw new Error(`text not found: ${text}`);
    await moveTo(e.x1, e.y1);
    await sleep(120);
    await page.mouse.down();
    await moveTo(e.x2, e.y2, ms);
    await page.mouse.up();
    await sleep(450);
  }
  async function saveShortcut() {
    await page.keyboard.down("Meta"); await page.keyboard.press("Enter"); await page.keyboard.up("Meta");
  }
  return { moveTo, center, click, typeSlowly, scrollBy, select, saveShortcut, get pos() { return pos; } };
}
