---
name: refresh-demo-media
description: Re-record the product site's demo video (site/img/demo.mp4), its poster, the app screenshots and the og.png link preview from the live demo build, using scripts/media/. Use when the user asks to refresh, re-record or update the demo video, screenshots or site images, or after a release whose UI changes make the site's media out of date.
---

# Refresh the site's demo media

The scripts and their full description are in `scripts/media/README.md`;
read it first. This skill is the procedure around them.

## 1. Decide what needs refreshing

- Compare `scripts/media/README.md` ("Last made") with `CHANGELOG.md`: list
  the released changes since then that are visible in the video
  (the flow in `record.mjs`) or in a still (`shoot.mjs`).
- Nothing visible changed → tell the user and stop.
- A change the video should *show* (a new feature) means editing
  `record.mjs`'s script, not only re-running it. Agree the new flow with the
  user before editing: the video is the site's main pitch.
- Refresh only what's stale: `node shoot.mjs out <names…>` takes single
  stills.

## 2. Branch

From an up-to-date `main`: `git switch -c docs/refresh-demo-media-<YYYY-MM-DD>`.
Never work on `main`.

## 3. Build and serve the demo

```bash
cd desktop && npm run demo:bundle          # fails if a seed mark no longer matches
cd frontend && npm run dev:demo -- --strictPort   # run in the background; port 3000
```

Wait until `http://localhost:3000/bundle.json` answers 200.

## 4. Record, encode, shoot

In `scripts/media/`:

```bash
npm install
rm -rf out profile
npm run record      # ~65 s; prints "note saved", "copied", "stopped"
npm run encode
npm run stills
for f in app-light app-dark status search book marks; do cwebp -quiet -q 82 -m 6 out/$f.png -o out/$f.webp; done
npm run og
```

**If a step fails**, the script prints the selector and saves
`out/fail.png`. Look at the screenshot, find the renamed or moved element in
`frontend/src/`, and update the selector in `record.mjs` / `shoot.mjs` (keep
selecting by `aria-label` or role, not by class names, which are hashed).
Then start again from `rm -rf out profile`: a failed take leaves marks in
the profile.

## 5. Review before replacing anything

Read (view) every output image: `out/demo-poster.png`, `out/og.png` and each
still. For the video, view a few frames from `out/frames/` across the take
(start, the Send dialog, the end on the Marks view). Check:

- No demo banner, no error states, no half-open menus or stray hover cards.
- Text is readable and the UI matches the current release.
- The poster shows the Send dialog's Text tab. If the flow's length changed,
  adjust `POSTER_BEFORE_END` in `encode.mjs`.
- Duration is about a minute (`encode` prints it); much longer means a stall
  the clamp didn't catch.

Show the user the poster, `og.png` and the stills, and get their OK before
copying.

## 6. Replace and check the site

```bash
cd scripts/media
cp out/demo.mp4 out/demo-poster.webp out/og.png ../../site/img/
for f in app-light app-dark status search book marks; do cp out/$f.webp ../../site/img/; done
```

- Update "Last made" in `scripts/media/README.md` (date and version).
- Open `site/index.html` and check the video plays and the images load.
- `git status` should list only `site/img/*` and the README (plus any script
  edits). `out/` and `profile/` are ignored.
- Stop the dev server.

## 7. Commit

Only when the user asks: `docs: refresh the demo video and screenshots for X.Y.Z`
(or name only what changed). Push the branch and hand over the compare URL;
the user opens and merges the PR. The Pages workflow publishes the new media
on merge.
