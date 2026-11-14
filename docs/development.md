# Developing Folio

How the code is laid out and how to run each part. To set up and send a
pull request, start with [CONTRIBUTING.md](../CONTRIBUTING.md); for the
design of each feature, see [design/](design/).

## Running the app

You need Node.js 20.19 or later (CI uses 24) and npm 10. Each package has
its own `package.json` and lock file; run `npm install` in the one you work
on.

```bash
cd desktop
npm install
npm start            # build the frontend and the main process, launch the app
npm run dist:mac     # package → release/*.dmg and *.zip (also dist:win, dist:linux)
```

Pick the repository's `workspace/` folder when the app asks for one: it
holds two sample documents (`welcome.md` and `samples/code-demo.md`).

**Live reload:** run the Vite dev server (`npm run dev` in `frontend/`, port
3000), then `npm run dev` in `desktop/`.

**The live demo locally:** `npm run demo:bundle` in `desktop/`, then
`npm run dev:demo` in `frontend/`. It's the quickest way to work on the
frontend in a browser.

> **Note:** builds are unsigned unless a valid "Developer ID Application"
> certificate is in the keychain. If you launch Electron from a process that
> sets `ELECTRON_RUN_AS_NODE=1` (some editor extensions do), unset it first.

## How it fits together

The `desktop/` package wraps the React frontend in an Electron app. The
workspace scanner, the marks store and the read records
(`packages/core/`) run in the main process, and the UI reaches them over
IPC (`window.markdownApi`, from `desktop/src/preload.ts`). The page is
served from an `app://` scheme with a strict Content-Security-Policy.

The same frontend is built a second time as the live demo
(`--mode demo`): its data source (`frontend/src/demo/`) reads a bundle of
the sample repository in `demo/` and keeps marks in the browser.

The MCP server (`packages/mcp/`) compiles the same core into one file, so an
agent reads and answers the notes the app wrote in `~/.folio`.

## Project structure

```
folio/
├── workspace/                    # two sample documents to try the app on
├── demo/                         # the live demo's sample repository and seed marks
├── tests/fixtures/               # workspace, expected scan and marks for the tests
├── docs/                         # this page, releasing.md, design/ (one doc per feature)
├── docs-site/                    # the user docs (VitePress), at /folio/docs/
├── site/                         # the product site (plain HTML), on GitHub Pages
├── scripts/                      # release.mjs; media/ records the site's video and screenshots
│
├── packages/core/src/            # shared by the app, the demo and the MCP server
│   ├── scanner.ts                # workspace scanner, document IDs, titles
│   ├── headings.ts, sections.ts  # headings, and which sections changed
│   ├── marks.ts, markTypes.ts    # highlights, notes and bookmarks in ~/.folio
│   ├── reads.ts, snapshots.ts    # which version of each document was read
│   ├── reviewNotes.ts            # notes as Markdown for an agent
│   ├── sourceMap.ts              # where a highlighted quote is in the source
│   ├── git.ts                    # read-only git: finding it, files on other branches
│   └── settings.ts               # the settings other processes read from settings.json
│
├── packages/mcp/                 # the MCP server (@crazzybot/folio-mcp)
│   ├── build.mjs                 # bundles it with the core into dist/folio-mcp.mjs
│   └── src/                      # folio.ts (the tools' work), server.ts, index.ts (stdio)
│
├── .claude-plugin/marketplace.json  # this repository as a Claude Code plugin marketplace
├── plugins/folio/                # the plugin: .mcp.json and the /folio:review skill
│
├── desktop/
│   ├── scripts/                  # copy-renderer.mjs, demo-bundle.mjs
│   └── src/
│       ├── main.ts               # window, app:// scheme, IPC, menus, PDF export
│       ├── preload.ts            # exposes window.markdownApi
│       ├── git.ts, gitBases.ts   # branches, worktrees, changes on the branch
│       ├── watcher.ts            # watches the workspace and ~/.folio for live reload
│       ├── search.ts, images.ts, files.ts   # full-text search, served images and linked files
│       ├── settings.ts, viewState.ts, windowState.ts, recent.ts
│       ├── editor.ts, cli.ts, openPaths.ts  # Open in Editor, the folio command, Open With
│       ├── customCss.ts          # custom.css
│       └── updater.ts            # updates from GitHub Releases
│
└── frontend/
    ├── vite.config.ts            # chunk splitting, the demo build
    ├── scripts/                  # third-party licence notices and their allow-list check
    └── src/
        ├── App.tsx               # layout, data fetching
        ├── api.ts, dataSource.ts # the IPC bridge, or the demo's bundle
        ├── demo/                 # the live demo's data source
        ├── index.css             # design tokens
        └── components/           # document list, viewer, marks, settings…
```

## Checks

These are what CI runs; run them for every package you touched. A change to
the core is compiled into the frontend, the desktop app and the MCP server,
so run their checks too.

```bash
cd frontend      && npm run lint && npx tsc --noEmit && npm test
cd desktop       && npx tsc --noEmit && npm test
cd packages/core && npm run typecheck && npm test
cd packages/mcp  && npm run typecheck && npm test && npm run build
cd docs-site     && npm run build
node scripts/release.mjs --check          # versions agree everywhere
```

Other scripts:

```bash
cd frontend
npm run dev          # Vite dev server at http://localhost:3000, for the desktop app's live reload
npm run dev:demo     # the live demo at http://localhost:3000 (after npm run demo:bundle in desktop/)
npm run build:demo   # the live demo → dist-demo/

cd packages/mcp
node dist/folio-mcp.mjs --root ../../workspace   # serve over stdio, as an agent starts it

cd docs-site
npm run dev          # the user docs at http://localhost:5173/folio/docs/
```

### Test fixtures

`tests/fixtures/workspace/` is a small workspace for the core and desktop
tests, and `tests/fixtures/expected-scan.json` is what scanning it must
produce (document IDs, titles, headings, images). Document IDs are part of
deep links and marks, so change the expected output only deliberately, when
the scanning rules change.

## Third-party licences

Every build writes the notices of the open-source packages in it to
`third-party-licenses.txt` (`frontend/scripts/licenses.mjs`). CI fails when
a production dependency's licence isn't on the allow-list in
`frontend/scripts/check-licenses.mjs`.

## Self-hosting

Up to version 0.4.0 Folio also ran in the browser from a self-hosted server
(Python backend and Docker). It was dropped after 0.4.0; the
[`v0.4.0` tag](https://github.com/crazzybot/folio/tree/v0.4.0) has it and
its instructions. Its marks (the `marks/` folder in its data volume) use the
same format as the desktop app's `~/.folio/marks/`, so they can be copied
across.
