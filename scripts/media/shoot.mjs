// The site's still screenshots, from the sample repository (demo/relay), with
// the marks record.mjs left (same browser profile).
import { sleep, launch, newPage, setPrefs, idOf, docUrl } from "./lib.mjs";
const out = process.argv[2];
const only = process.argv.slice(3);
const browser = await launch();
async function shot(name, { prefs, doc, w = 1440, h = 900, act, keepMouse, noShot }) {
  if (only.length && !only.includes(name)) return;
  const page = await newPage(browser);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await setPrefs(page, prefs);
  await page.goto(docUrl(await idOf(doc)), { waitUntil: "networkidle0" });
  await sleep(1500);
  if (act) await act(page);
  if (!keepMouse) await page.mouse.move(w - 2, h - 2);
  await sleep(300);
  if (!noShot) await page.screenshot({ path: `${out}/${name}.png`, captureBeyondViewport: false });
  await page.close();
}
const scrollTo = (text) => async (p) => {
  await p.evaluate((text) => {
    const h = [...document.querySelectorAll("article.folio-document h2, article.folio-document h3")].find((e) => e.textContent.includes(text));
    h.scrollIntoView({ block: "start" });
  }, text);
  await sleep(600);
};
const base = {
  "folio.groupByFolder": "true",
  "folio.outline": "true",
  "folio.expandedFolders": JSON.stringify(["docs", "docs/adr", "docs/specs"]),
};
const spec = "docs/specs/delivery-queue.md";
const adr3 = "docs/adr/0003-hmac-signatures.md";
await shot("app-light", { doc: adr3, prefs: { ...base, "folio.theme": "light" } });
await shot("app-dark", { doc: adr3, prefs: { ...base, "folio.theme": "dark" } });
await shot("status", { doc: "docs/adr/0004-retry-on-a-fixed-schedule.md", prefs: { ...base, "folio.theme": "light" },
  act: async (p) => {
    await p.click('button[aria-label^="Filter by status and tags"]');
    await sleep(500);
    const [item] = await p.$$('xpath/.//*[@role="menu"]//*[@role="menuitemcheckbox" or @role="menuitem"][contains(., "#retries")]');
    await item.click();
    await sleep(300);
    await p.keyboard.press("Escape");
    await sleep(400);
    const row = await p.$('[aria-label*="Exponential backoff"]');
    const b = await row.boundingBox();
    await p.mouse.move(b.x + 60, b.y + 60);
    await p.mouse.move(b.x + 120, b.y + b.height / 2, { steps: 12 });
    await sleep(2500);
    // page.screenshot dismisses the card; capture straight from the compositor
    const cdp = await p.createCDPSession();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 900, scale: 2 } });
    (await import("node:fs")).writeFileSync(`${out}/status.png`, Buffer.from(data, "base64"));
  }, keepMouse: true, noShot: true });
await shot("search", { doc: "docs/adr/0005-exponential-backoff.md", prefs: { ...base, "folio.theme": "dark", "folio.searchDocumentText": "true" },
  act: async (p) => { await p.type('input[placeholder^="Search"]', "receiver"); await sleep(1500); } });
await shot("book", { doc: "docs/research/queue-options.md", prefs: { ...base, "folio.expandedFolders": JSON.stringify(["docs", "docs/research"]), "folio.theme": "light", "folio.docStyle": "book", "folio.readingWidth": "narrow", "folio.fontSize": "large" } });
await shot("marks", { doc: spec, prefs: { ...base, "folio.theme": "light", "folio.sidebarView": "marks" }, act: scrollTo("Ordering") });
await browser.close();
