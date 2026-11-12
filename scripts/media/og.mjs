// The 1200×630 link preview (site/img/og.png) from app-light.png: og.html
// lays it out beside the tagline. Run after shoot.mjs, with its output folder.
import { copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] ?? "out");
copyFileSync(join(here, "og.html"), join(dir, "og.html"));
copyFileSync(join(here, "../../site/img/icon.png"), join(dir, "icon.png"));
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.goto(`file://${dir}/og.html`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await sleep(500);
await page.screenshot({ path: `${dir}/og.png` });
await browser.close();
