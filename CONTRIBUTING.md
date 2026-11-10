# Contributing to Folio

Thanks for taking the time to help. Bug reports, ideas and pull requests are
all welcome.

## Reporting bugs and asking for features

- **Bugs** — open an issue with the *Bug report* form. Include your OS, Folio
  version (**Folio → About Folio**) and, if you can, a small Markdown file that
  shows the problem.
- **Features** — open an issue with the *Feature request* form before writing
  a large change, so we can agree on the approach first.
- **Security issues** — please don't open a public issue; see
  [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 20.19 or later (CI uses 24) and npm.

```bash
git clone https://github.com/crazzybot/folio.git
cd folio

# Desktop app (builds the frontend too)
cd desktop && npm install && npm start
```

For live-reload development of the desktop app and running the live demo
locally, see the [README](README.md#quick-start).

## Before opening a pull request

Run the same checks as CI for the parts you changed:

```bash
# frontend/
npm run lint && npx tsc --noEmit && npm test

# desktop/
npx tsc --noEmit && npm test
```

A few things worth knowing:

- **Document IDs are part of links.** The scanner (`desktop/src/scanner.ts`)
  is tested against `tests/fixtures/expected-scan.json`; IDs and titles must
  stay stable, since deep links and marks rely on them. If you change
  scanning rules, update the fixture deliberately.
- **Untrusted Markdown.** Documents may come from cloned repositories, so
  rendering and file serving are locked down (see
  [Security](README.md#security) in the README). Changes that loosen the HTML
  sanitizer, the CSP, the served file types or Electron's sandboxing need a
  clear reason in the PR.
- **Docs.** If you change behavior a user can see, update the README too.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with the
area as the scope, for example:

```
feat(desktop): open recent folders from the Dock menu
fix(frontend): keep scroll position when a document reloads
docs: explain the skipDirs setting
```

Keep pull requests focused on one change; small PRs get reviewed faster.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
