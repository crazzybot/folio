# CLAUDE.md

Folio is a desktop app (Electron + React) for reading and reviewing folders of
Markdown: specs, ADRs, notes, Obsidian vaults. It never writes to the
documents it opens; highlights, notes and bookmarks live in `~/.folio`.
Public repo `crazzybot/folio`, MIT. The README is the overview (core
features, install, build); the user docs (`docs-site/`) are the full user
reference, `docs/development.md` and `docs/releasing.md` the developer one.
CONTRIBUTING.md has the checks and commit conventions.

## Layout

| Path | What |
|---|---|
| `frontend/` | React + Vite + TypeScript UI. Built twice: for the desktop app, and as the live demo (`--mode demo`) |
| `desktop/` | Electron main process (`src/main.ts`: window, `app://` scheme, IPC, menus), preload, updater, packaging |
| `packages/core/` | Scanner, marks store, source mapping, review notes formatting. Compiled from source into the app, the demo and the MCP server; no build step of its own |
| `packages/mcp/` | The MCP server (`@crazzybot/folio-mcp` on npm): review notes and replies for coding agents. Bundled by esbuild; its own version |
| `demo/` | The live demo's sample repository (`relay/`) and seed marks. `demo/build/` is generated |
| `site/` | Product site (plain HTML/CSS/JS), on GitHub Pages at `crazzybot.github.io/folio/` |
| `docs-site/` | User docs (VitePress), published at `/folio/docs/`. Linked from Help → Folio Documentation and the demo banner |
| `docs/design/` | Design docs for contributors, one per feature, with a `Status:` line |
| `docs/development.md`, `docs/releasing.md` | Architecture, project structure, scripts; how each part is released |
| `scripts/release.mjs` | Prepares a release (version, CHANGELOG, `release-X.Y.Z` branch) |
| `scripts/media/` | Records the site's demo video, screenshots and link preview |
| `tests/fixtures/` | Workspace, expected scan and marks for core and desktop tests |
| `workspace/` | Two sample documents for trying the app |
| `notes/` | **Private, untracked** (excluded in `.git/info/exclude`). Never commit it, and never quote or link it from tracked files |

## Dev environment

- Node 24 (CI), 20.19 minimum; npm. Each package has its own `package.json`
  and lock file; there is no root workspace. Run `npm install` in the package
  you work on.
- macOS is the main dev platform. Google Chrome is used by
  `scripts/media/`; `cwebp` (`brew install webp`) for images.
- `gh` isn't installed: push the branch and give the user the compare URL
  (`https://github.com/crazzybot/folio/compare/<branch>?expand=1`) instead of
  opening the PR yourself.
- If a tool sets `ELECTRON_RUN_AS_NODE=1`, unset it before launching Electron.

| Task | Command |
|---|---|
| Run the app | `cd desktop && npm start` (builds the frontend and main process) |
| Live reload | `npm run dev` in `frontend/` (port 3000), then `npm run dev` in `desktop/` |
| Live demo locally | `npm run demo:bundle` in `desktop/`, then `npm run dev:demo` in `frontend/` |
| User docs locally | `cd docs-site && npm run dev` → `localhost:5173/folio/docs/` |
| Package | `npm run dist:mac` (or `dist:win`, `dist:linux`) in `desktop/` |

## Checks (what CI runs)

Run these for every package you touched before committing:

```bash
cd frontend      && npm run lint && npx tsc --noEmit && npm test
cd desktop       && npx tsc --noEmit && npm test
cd packages/core && npm run typecheck && npm test
cd packages/mcp  && npm run typecheck && npm test && npm run build
cd docs-site     && npm run build
node scripts/release.mjs --check          # versions agree everywhere
```

A change to the core is compiled into the frontend, desktop and MCP server
too, so run their checks as well. Pages that change the site or the demo: look at them at
phone width (375px and 320px), with no horizontal scroll.

## Rules that are easy to break

- **Never write to the user's documents.** Folio is read-only on the
  workspace; anything Folio keeps goes in `~/.folio` or the app's data folder.
- **Document IDs are part of links and marks.** `tests/fixtures/expected-scan.json`
  pins scanner output; change it only on purpose, when the scanning rules
  change, and say why in the PR.
- **Markdown is untrusted.** Don't loosen the sanitizer (`rehype-sanitize`),
  the CSP in `desktop/src/main.ts`, the served file types or Electron's
  sandboxing without a clear reason stated in the PR.
- **One version.** `desktop/` and `frontend/` share a version; only
  `scripts/release.mjs` changes it.
- **Demo selectors.** `scripts/media/` finds elements by `aria-label` and
  role. Renaming a label the recording uses breaks it: check
  `scripts/media/*.mjs` when you change one.

## Git and pull requests

- **Never commit to `main`, and never push to it.** All work happens on a
  branch and lands through a pull request, squash-merged.
- **One branch per change**, from an up-to-date `main`, named by type:
  `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`.
  Releases use `release-X.Y.Z` (made by `scripts/release.mjs`).
- **Conventional Commits** with the area as scope:
  `feat(desktop): …`, `fix(frontend): …`, `docs: …`. The PR title follows
  the same form; it becomes the squashed commit on `main`.
- **Commit and push only when the user asks.** Never force-push a branch
  that's been pushed unless the user asks for it; never force-push `main`.
- **Don't tag or release.** Tags (`vX.Y.Z`) and publishing are done by hand
  by the maintainer (`docs/releasing.md`).
- **Checks pass before every commit** (above). If one fails, fix it or say
  so; don't commit around it.
- **User-visible change:** a bullet under `## [Unreleased]` in
  `CHANGELOG.md`, and the user docs in `docs-site/` (the `sync-docs-site`
  skill). The README's Features list changes only for a core feature: keep
  it to one line each. Design changes update or add a doc in `docs/design/`.
- **Keep PRs focused**: one feature or fix. Unrelated cleanups go in their
  own PR.

## Style

- Match the surrounding code: its comment density, naming and idioms.
  Comments say why, in plain sentences.
- TypeScript is strict with `noUncheckedIndexedAccess`; no `any`.
- CSS uses the design tokens in `frontend/src/index.css`; components use CSS
  modules.
- Writing (README, docs, changelog, UI text): short, plain sentences; name
  UI elements in **bold** as they appear; macOS shortcut first, then
  Windows/Linux (`⌘F` / `Ctrl+F`).

## Skills

- `refresh-demo-media`: re-record the site's demo video, screenshots and
  link preview.
- `sync-docs-site`: bring `docs-site/` up to date with released features.
