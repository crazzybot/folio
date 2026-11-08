# Live demo

Status: planned.

A version of Folio that runs entirely in the browser on a sample repository,
published with the product site at `crazzybot.github.io/folio/demo/`. A
visitor can try the whole review flow without installing anything: browse
the docs, search, highlight, write notes, open the Marks view and copy the
review notes. It's aimed at the Show HN launch, where most readers won't
download an app to find out what "a reader for reviewing specs" means.

**It's the same frontend, built a third way.** Today the frontend gets its
data from the REST backend (browser version) or over IPC (desktop app). The
demo adds a third source that runs in the page: documents from a JSON bundle
made at build time, search done in the browser, marks in `localStorage`. No
server, nothing to keep running, and every visitor's marks are their own.

## Decisions

| Question | Decision |
|---|---|
| Hosting | GitHub Pages, as a folder of the existing site. No server: the backend's marks are shared by everyone using it, so a hosted backend would need sessions, isolation and resets to be a public demo |
| Codebase | The frontend as is, plus a demo data source chosen at build time (`vite build --mode demo`). Normal builds don't include it |
| Documents | A JSON bundle made at build time with the desktop app's scanner, so titles, headings and ids match the app exactly |
| Search | In the browser, mirroring `desktop/src/search.ts`, as the desktop app mirrors the backend |
| Marks | `localStorage`, per visitor. No validation beyond what the UI already ensures: nothing is shared, so nothing to protect |
| First visit | A few marks are already there (two notes, a highlight, a bookmark), so the Marks view and Copy review notes have something to show. **Reset demo** brings them back |
| Routing | `HashRouter` (`/folio/demo/#/doc/…`) and a relative base, so deep links survive a reload on Pages (which has no SPA fallback for a subfolder) and the demo works under any path or a custom domain later |
| Content | The Relay repository from the video, extended, committed in `demo/relay/` |
| Built from | `main`, on every push that touches the frontend or the demo. It can run ahead of the latest release, so a visitor may try a feature the download doesn't have yet. Building from the release tag is the fix if that starts to matter |
| Desktop-only features | Already hidden in browser mode (Open in editor, workspace settings). Linked files open from the static copy of the workspace |
| Analytics | None. GitHub Pages has none, and the demo adds no counter |
| Mobile | The same demo, with no phone-specific layout or behaviour |

## 1. Data source in `api.ts`

`frontend/src/api.ts` has one `if (desktopApi)` branch per call. Replace
them with a single source chosen once:

```ts
interface DataSource {
  listDocuments(): Promise<DocumentMeta[]>;
  getDocumentContent(id: string): Promise<DocumentContent>;
  searchDocuments(query: string): Promise<SearchResult[]>;
  listAttachments(): Promise<string[]>;
  workspaceFileUrl(location: string): string;
  marks: { list, addHighlight, updateHighlight, deleteHighlight,
           addBookmark, deleteBookmark, relink, forget };
}
```

- `httpSource` (today's `fetch` code) and `desktopSource` (a thin wrapper over
  `window.markdownApi`) cover the existing two cases.
- `demoSource` is loaded only when `import.meta.env.MODE === "demo"`. Vite
  replaces the constant at build time, so other builds drop the demo code.
- The exported functions keep their names and signatures: no component
  changes.

This step changes no behaviour and ships on its own, with the existing tests
as the check.

## 2. Demo source (`frontend/src/demo/`)

- **`bundle.json`**, fetched once on load: `documents` (the `DocumentMeta`
  list), `contents` (id → Markdown), `attachments`, and `seedMarks`.
- **Search** (`search.ts`): `searchContent()` and its snippet rules mirrored
  from `desktop/src/search.ts` (same limits: 2–200 characters, 200 results,
  3 snippets). A test runs both on the same inputs, so they can't drift.
- **Marks** (`marks.ts`): one `localStorage` entry keyed by document id,
  holding the same `Highlight` / `Bookmark` shapes the backend returns. Ids
  from `crypto.getRandomValues`, timestamps from the clock. `missing` is
  always empty, since the documents never change, and `relink` / `forget`
  are no-ops. Storage that throws (private windows, blocked storage) falls
  back to memory: marks then last until the tab closes.
- **Files**: `workspaceFileUrl()` returns `workspace/<location>`, a static
  copy of the demo repository published next to the app. Images and linked
  files work with no special handling.

## 3. Demo content and bundle

- `demo/relay/`: the Relay repository from the site video, moved from
  `notes/demo/`. Extended so each feature has something to show: a few
  longer ADRs, an image, a formula, an Obsidian-style `[[link]]`, and enough
  text that full-text search finds several documents.
- `desktop/scripts/demo-bundle.mjs` (`npm run demo:bundle` in `desktop/`):
  runs the desktop scanner (`scanWorkspace`, `scanAttachments`) over
  `demo/relay/` and writes `bundle.json` and the static copy of the
  workspace to `demo/build/` (not committed). It lives with the desktop
  package because it uses the desktop's compiled modules. In demo mode Vite
  serves `demo/build/` as its public folder, so `npm run dev:demo` in
  `frontend/` runs the demo locally and the demo build includes the data.
- `demo/seed-marks.json`: the first-visit marks, as quotes and headings. The
  script resolves them to `DocumentMarks` and fails the build if a quote is no
  longer in its document, so editing the demo docs can't silently drop them.

## 4. Demo build

- `frontend`: `npm run build:demo` → `vite build --mode demo --base ./`,
  output into `frontend/dist-demo/` with the bundle and workspace copy.
  It fails when `demo/build/` is missing.
- `main.tsx`: `HashRouter` in demo mode, `BrowserRouter` otherwise. An
  address with no document opens the sample repository's README (its id
  comes from the bundle at build time). Links to other documents get their
  `href` from the router, so a new tab or a copied link uses `#/doc/…` too.
- **Banner** above the app, demo mode only: "Demo with a sample repository.
  Your marks stay in this browser." with **Download Folio** (back to the
  site) and **Reset demo** (clears the demo's marks and view preferences,
  then reloads).
- View preferences use the existing `localStorage` keys. They're per origin,
  and the site uses only `folio.latestRelease`, so there's no clash.

## 5. Publishing

`.github/workflows/pages.yml`:

1. Set up Node, `npm ci` in `frontend/` and `desktop/`.
2. Build the desktop modules (`tsc`), run `demo-bundle.mjs`.
3. `npm run build:demo` in `frontend/`.
4. Assemble the artifact: `site/` plus the demo in `site/demo/`.

Add `frontend/**`, `demo/**` and `desktop/src/{scanner,search}.ts` to the
workflow's `paths`, so app changes redeploy the demo. CI (`ci.yml`) also
runs `npm run build:demo`, so a change that breaks the demo fails its PR
rather than the deploy.

**Site:** a "Try it in your browser" link in the hero beside Download, and
on the download page. README: a link under the screenshot.

## 6. Tests

- Unit tests for the demo source: listing, content, attachments, marks
  CRUD, seed marks, reset, storage that throws.
- Search parity with `desktop/src/search.ts` (above).
- The existing component tests stay on the HTTP source and are unaffected.
- Manual check before the launch: the review flow end to end in Chrome,
  Safari and Firefox, and on a phone.

## Phases

1. Data-source refactor in `api.ts`. No behaviour change. *(half a day)*
2. Demo source with its tests. *(half a day)*
3. Demo content, seed marks and the bundle script. *(half a day)*
4. Demo build: router, banner, reset. *(a few hours)*
5. Pages workflow, CI step, site and README links. *(a few hours)*

About two days in all. Each phase is a PR of its own; only phase 5 makes the
demo public.
