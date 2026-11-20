# Site media: demo video, screenshots and link preview

Scripts that make the product site's media in `site/img/`, from the live
demo build (`demo/relay/` and `demo/seed-marks.json`) in headless Chrome:

| File | Made by |
|---|---|
| `demo.mp4` (~101 s), `demo-poster.webp` | A screen recording of the desktop app with Claude Code, in a workspace from `workspace.mjs`, edited by hand (see below) |
| `app-light.webp`, `app-dark.webp`, `status.webp`, `search.webp`, `book.webp`, `marks.webp` | `shoot.mjs` (1440×900 @2x), then `cwebp` |
| `og.png` (1200×630 link preview) | `og.mjs` + `og.html`, from `app-light.png` |

Last made: stills and `og.png` 2026-11-17 (0.9.0, with the status icons
from `feat/status-lifecycle`); video and poster 2026-11-19 (0.10.0).

The site's video is no longer made by `record.mjs`: it shows the review
loop with a real agent, which the browser demo can't. Don't copy
`out/demo.mp4` or `out/demo-poster.webp` over it unless you mean to go
back to the scripted take. The recording was edited with ffmpeg: typing
at 4×, waiting for the agent at 8×, then scaled to 1600 px wide at 30 fps
(`-crf 23 -tune stillimage`). The poster is the frame where Claude Code's
reply to a note is open beside the diff.

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

- `workspace.mjs`: a fresh workspace for recording the desktop app with an
  agent, `~/folio-video` by default (or the folder given): `demo/relay` as
  its own git repository, with `docs/specs/delivery-queue.md` added on the
  branch `spec/delivery-queue`. Run it again between takes: it first deletes
  Folio's marks and read records for that folder from `~/.folio`, which are
  keyed by path and would otherwise come back. Quit Folio before running it.
  Doesn't need `npm install`.

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

# 3. Look at every file in out/, then copy them over (not the video: see above)
cp out/og.png ../../site/img/
for f in app-light app-dark status search book marks; do cp out/$f.webp ../../site/img/; done
```

Update "Last made" above when you replace them.
