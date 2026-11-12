// Records the review-workflow demo: focus docs/specs, open the proposed spec,
// annotate it, ask for it to be accepted once fixed, send the review notes
// (the list, then the Markdown, then Copy), see them turn sent, and the
// Marks view's summary.
import { writeFileSync, mkdirSync } from "node:fs";
import { BASE, sleep, launch, newPage, setPrefs, idOf, docUrl, mouse } from "./lib.mjs";
const OUT = process.argv[2];

const browser = await launch();
await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await newPage(browser);
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

// A visible cursor (headless Chrome draws none), with a ring on click
await page.evaluateOnNewDocument(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 9.5-6.2 1.2 3.6 6.8-2.6 1.3-3.6-6.8L3 18z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-3px,-2px)" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", width: "28px", height: "28px", margin: "-14px 0 0 -14px", borderRadius: "50%", border: "2px solid rgba(31,111,242,.7)", zIndex: 2147483646, pointerEvents: "none", opacity: "0", transition: "opacity .35s, transform .35s" });
    document.body.append(ring, c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      Object.assign(ring.style, { left: e.clientX + "px", top: e.clientY + "px", transition: "none", opacity: "1", transform: "scale(.5)" });
      requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(ring.style, { transition: "opacity .45s, transform .45s", opacity: "0", transform: "scale(1.3)" })));
    }, true);
  });
});

// The seed marks (demo/seed-marks.json), so the spec starts without any (a
// failed take leaves some), plus a verdict on ADR 0003 asking for "accepted"
const SEED_TIME = "2026-11-01T09:00:00Z";
await setPrefs(page, {
  "folio.theme": "light",
  "folio.groupByFolder": "true",
  "folio.outline": "true",
  "folio.expandedFolders": JSON.stringify(["docs", "docs/adr", "docs/specs"]),
}, {
  [await idOf("docs/adr/0003-hmac-signatures.md")]: {
    note: { text: "Fine once the rotation question is answered.", requestedStatus: "accepted", created: SEED_TIME, updated: SEED_TIME },
  },
});
await page.goto(docUrl(await idOf("README.md")), { waitUntil: "networkidle0" });
await sleep(1200);
const m = mouse(page, OUT);
await page.mouse.move(640, 600);

process.on("unhandledRejection", async (e) => { console.error(e.message); await page.screenshot({ path: `${OUT}/fail.png` }); process.exit(1); });
// Frames straight from CDP to disk, encoded afterwards (encoding live slows the page)
mkdirSync(`${OUT}/frames`, { recursive: true });
const cdp = await page.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `frames/${String(frames.length).padStart(5, "0")}.jpg`;
  writeFileSync(`${OUT}/${file}`, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
const recorder = { stop: async () => {
  await cdp.send("Page.stopScreencast");
  frames.push({ file: frames.at(-1).file, t: Date.now() / 1000 });
  writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
} };
await sleep(900);

// Glance over the ADRs' statuses, then focus on docs/specs
const adr = await m.center('[aria-label*="Retry on a fixed schedule"]');
await m.moveTo(adr.x - 40, adr.y);
await sleep(2200);
const row = await m.center('li:has([aria-label="Focus on docs/specs"])');
await m.moveTo(row.x, row.y);
await sleep(300);
await m.click('[aria-label="Focus on docs/specs"]', 900);

// Open the proposed spec
await m.click('[aria-label*="Spec: offline delivery queue"]', 1600);

// Read down to the design
await m.moveTo(820, 520);
await m.scrollBy(330);
await sleep(700);

// A note on the retry policy
await m.select("retried indefinitely with exponential backoff");
await m.click('[role="toolbar"] [aria-label="Add note"]', 300);
await m.typeSlowly("Cap retries: indefinite retries pile up forever. Suggest 24 h, then mark the endpoint failed.");
await sleep(300);
await m.saveShortcut();
await sleep(700);

// A note on dropping undelivered events
await m.moveTo(820, 560);
await m.scrollBy(200, 600);
await m.select("along with any events still in them");
await m.click('[role="toolbar"] [aria-label="Add note"]', 300);
await m.typeSlowly("This loses undelivered events, which breaks the first goal. Archive them or alert first.");
await sleep(300);
await m.saveShortcut();
await sleep(600);

// A plain highlight on an open question
await m.select("Should tenants be able to pause an endpoint?");
await m.click('[role="toolbar"] [aria-label="Highlight green"]', 900);

// The verdict on the whole spec: accept it once the two points are fixed
await m.click('main [aria-label="Note on this document"]', 700);
const sel = '[role="dialog"][aria-label="Note on this document"] select';
await m.moveTo(...Object.values(await m.center(sel)));
await sleep(250);
await page.select(sel, "accepted");
await sleep(700);
await m.click('[role="dialog"][aria-label="Note on this document"] textarea', 250);
await m.typeSlowly("Accept once retries are capped and nothing is dropped.");
await sleep(400);
await m.click('[role="dialog"][aria-label="Note on this document"] button:last-child', 1300);

console.log('note saved', new Date().toISOString());
// Send review notes: the list (the green highlight is private, so not in it),
// the Markdown an agent gets, then Copy
await m.click('main [aria-label^="Send review notes"]', 2600);
await m.click('[role="dialog"] [role="tab"]:nth-child(2)', 4000);
await m.click('[role="dialog"] footer button:last-child', 900);

// Sent: dashed underlines, sent icons, "Sent 3 notes · Undo". The cursor
// waits in the outline's blank space, where it shows no hover controls
console.log('copied', new Date().toISOString());
await m.moveTo(1150, 520);
await sleep(2000);

// The Marks view: what was sent and what wasn't, by document. The cursor
// waits below the list, so no hover card covers it
await m.click('[data-view="marks"]', 500);
await m.moveTo(130, 700);
await sleep(3000);

await recorder.stop();
console.log('stopped', new Date().toISOString());
await browser.close();
