# Site media: demo video, screenshots and link preview

Scripts that make the product site's media in `site/img/`, from the live
demo build (`demo/relay/` and `demo/seed-marks.json`) in headless Chrome:

| File | Made by |
|---|---|
| `demo.mp4` (~63 s), `demo-poster.webp` | `record.mjs`, then `encode.mjs` |
| `app-light.webp`, `app-dark.webp`, `status.webp`, `search.webp`, `book.webp`, `marks.webp` | `shoot.mjs` (1440×900 @2x), then `cwebp` |
| `og.png` (1200×630 link preview) | `og.mjs` + `og.html`, from `app-light.png` |

Last made: video, poster, stills and `og.png` 2026-11-14 (0.7.0,
unreleased).

- `lib.mjs`: shared puppeteer-core helpers (eased mouse, text selection),
  against the demo build at `http://localhost:3000`: documents from its
  `bundle.json`, marks in the page's localStorage, the demo banner hidden.
  Every script uses one browser profile (`./profile`, or
  `FOLIO_DEMO_PROFILE`), so the stills show the marks the recording made.
  Chrome is found at its macOS path, or `CHROME_PATH`.
- `record.mjs`: resets the marks to the seed plus a note on ADR 0003 asking
  for "accepted", then: hover ADR 0004 (hover card), focus docs/specs, open
  the delivery queue spec, two notes (shown inline under their passages)
  and a highlight (private: not sent), a note on the document asking for
  "accepted", Send review notes: the list, the Text tab, Copy. Then the
  notes are sent (dashed underlines, "Sent 3 notes · Undo") and the Marks
  view sums it up. Draws its own cursor. Captures JPEG frames over CDP to
  `out/frames/` and `out/frames.json` (encoding live made the page stall).
- `encode.mjs`: the frames into `out/demo.mp4` (each frame lasts until the
  next; stalls over 5 s cut to 1.6 s; the last frame held 1.5 s) and the
  poster, the Send dialog's Text tab about 11 s before the end.
- `shoot.mjs`: the stills. The status shot uses raw `Page.captureScreenshot`:
  `page.screenshot` dismisses the hover card. `node shoot.mjs out status`
  takes only the named shots.

The scripts find elements by their accessible names (`aria-label`, roles).
When a UI change breaks a step, the script stops with the failing selector
and saves `out/fail.png`.

## Making them

Needs Google Chrome and `cwebp` (`brew install webp`); ffmpeg comes with
the npm packages.

```bash
# 1. The demo data and the demo build, on port 3000
(cd desktop && npm run demo:bundle)
(cd frontend && npm run dev:demo)          # leave it running

# 2. In another terminal
cd scripts/media
npm install
rm -rf out profile                         # a clean take
npm run record                             # ~65 s
npm run encode
npm run stills
for f in app-light app-dark status search book marks; do cwebp -quiet -q 82 -m 6 out/$f.png -o out/$f.webp; done
npm run og

# 3. Look at every file in out/, then copy them over
cp out/demo.mp4 out/demo-poster.webp out/og.png ../../site/img/
for f in app-light app-dark status search book marks; do cp out/$f.webp ../../site/img/; done
```

Update "Last made" above when you replace them.
