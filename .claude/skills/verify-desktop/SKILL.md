---
name: verify-desktop
description: Try a change in the real desktop app before calling it done. Build the dev app, launch it next to the user's own Folio without touching their settings or marks, drive it over CDP through the change's steps, and take screenshots of its window only. Use before saying "done" on any change to frontend/ or desktop/ that shows in the UI, or when asked to check, try or screenshot the change in the app.
---

# Verify a change in the desktop app

Tests and the browser demo don't show everything: the `app://` scheme, IPC,
menus, the agent panel and the file watcher only run in Electron. Try the
change there before saying it works, and say what you tried.

The user usually has their own Folio open (the released app, or a dev build
of their own). Everything here keeps away from it: its own user-data-dir and
HOME (so marks go to the scratch folder, not `~/.folio`), its own CDP port,
and screenshots of this window only.

## 1. Build

Build where the change is: the main folder, or the worktree you work in.

```bash
cd desktop && npm run build
```

A new worktree has no `node_modules`: `npm ci` in `frontend/` and
`desktop/` first (Electron downloads on first use). The driver needs
`puppeteer-core` from `scripts/media/`: `npm ci` there once.

## 2. Launch

```bash
.claude/skills/verify-desktop/scripts/launch.sh <scratch>/verify [workspace] [port]
```

- `<scratch>` is your scratchpad directory. The script prints the PID;
  the app's output goes to `<scratch>/verify/electron.log`.
- The workspace defaults to the repo's `workspace/` (two documents). For
  a change that needs more, copy `tests/fixtures/workspace/` or make a
  small folder in the scratchpad: never point it at the user's own folders.
- The agent command is `bash`, so the agent panel opens a shell, not a
  Claude Code session.
- The port defaults to 9333; give another one when two run at once.

## 3. Drive and screenshot

Write a step script in the scratch folder for the change's steps, and run
it with `FOLIO_SHOTS=<scratch>/verify/shots node step.mjs`:

```js
import { connect, shot, sleep } from "<repo>/.claude/skills/verify-desktop/scripts/drive.mjs";

const { browser, page } = await connect();          // the main window, loaded
await page.click('[aria-label="Welcome — welcome.md"]');
await shot("welcome");                              // <shots>/welcome.png
await browser.disconnect();                         // leaves the app running
```

- Find elements by `aria-label` and role, as `scripts/media/` does.
- `connect()` picks the main window; the agent panel is its own page
  (`agent.html`) in `browser.pages()`.
- Electron's CDP has no window commands: resize with `window.resizeTo`
  from the page.
- `shot()` captures only the window of the process that owns the CDP
  port, with `screencapture -l`. Never use `screencapture -R` or a full
  screen capture: they take whatever is on top, such as the user's
  browser, or the user's own Folio.
- Look at each screenshot (Read it) before saying what it shows.

Run steps again as needed; the app keeps running between scripts.

## 4. Stop and hand over

```bash
pkill -P <pid>; kill <pid>
```

In the handoff, say what you tried and what you saw, with the screenshots
that matter. Say where the change lives (main folder or worktree, which
branch) and how the user can run it there (`cd desktop && npm start`, after
`npm ci` in a fresh worktree). Say what you couldn't try (a dialog, a menu,
another platform).
