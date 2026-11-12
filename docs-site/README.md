# Folio user docs

Synced with: 0.5.0 (2026-11-12). The docs describe the latest release; the
`sync-docs-site` skill (`.claude/skills/`) brings them up to date.

The user documentation at <https://crazzybot.github.io/folio/docs/>, built
with [VitePress](https://vitepress.dev). The design docs for contributors are
in [docs/](../docs/); this folder is for people using Folio.

```bash
cd docs-site
npm install
npm run dev      # http://localhost:5173/folio/docs/
npm run build    # into .vitepress/dist
```

[pages.yml](../.github/workflows/pages.yml) builds it on pushes to `main`
and copies it into the Pages site as `docs/`, next to the product site and
the live demo. The desktop app's **Help → Folio Documentation** and the demo
banner link here, so keep the URL and the page paths stable.

`<!-- TODO … -->` comments mark gaps still to write; they're hidden on the
published pages.
