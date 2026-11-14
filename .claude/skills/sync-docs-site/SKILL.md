---
name: sync-docs-site
description: Bring the user documentation in docs-site/ up to date with Folio's released features, from CHANGELOG.md and the code. Use when the user asks to update, sync or check the docs site, after a release, or when a feature change should be reflected in the user docs.
---

# Sync the docs site with the latest features

`docs-site/` is the user documentation (VitePress), published at
`crazzybot.github.io/folio/docs/`. It describes the **latest release**, not
`main`: features under `## [Unreleased]` in `CHANGELOG.md` aren't documented
yet, unless the user is preparing that release.

## 1. Find what changed

- `docs-site/README.md` records "Synced with" a version. Read the
  `CHANGELOG.md` sections after that version up to the latest release.
- List each user-visible change: new features, renamed UI, new or changed
  shortcuts and menu items, changed defaults, removed features.
- Map each one to the page it belongs on (the sidebar in
  `docs-site/.vitepress/config.mts` lists them). A feature with no fitting
  page may need a new one; propose it to the user before creating it.
- Also check the open `<!-- TODO … -->` comments in `docs-site/`: a release
  may now answer one.

## 2. Check every fact against the code

The CHANGELOG says what was meant; the code says what shipped.
Before writing a claim, confirm it:

- Menu items and shortcuts: the menu template in `desktop/src/main.ts`
  (`accelerator:`). Keep `reference/shortcuts.md` in step with it.
- UI names: the labels and `aria-label`s in `frontend/src/components/`.
  Write UI names in **bold**, exactly as the app shows them.
- Settings: `desktop/src/settings.ts`. Keep `reference/settings.md` in step
  with it.
- Front matter and Markdown support: `packages/core/src/` and the frontend's
  remark/rehype plugins.

When the code and the CHANGELOG disagree, follow the code and tell the user.

## 3. Write

- Match the existing pages: short sentences, task-oriented headings, macOS
  shortcut first (`⌘F` / `Ctrl+F`), **bold** UI names, no marketing tone.
- Update existing pages before adding new ones. Keep page paths stable: the
  Help menu, the demo banner and outside links point at them. If a page must
  move, keep the old path working or tell the user.
- A gap you can't fill from the code or the CHANGELOG gets an
  `<!-- TODO: … -->` comment rather than a guess.
- Pro features (once they exist) get a **Pro** badge; don't document them
  before the release that ships them.
- Removed features: delete their docs, and check the FAQ.

## 4. Check

```bash
cd docs-site && npm run build
```

- The build must pass; VitePress fails on dead internal links.
- Preview (`npm run dev`) the pages you changed, in light and dark and at
  375px width.
- Update "Synced with" in `docs-site/README.md` to the release you synced to.

## 5. Branch and commit

Work on a branch from `main`: `docs/sync-docs-<version>`. Commit only when
the user asks, as `docs(docs-site): sync with X.Y.Z`. Summarise for the user
what changed, page by page, and the TODOs left.
