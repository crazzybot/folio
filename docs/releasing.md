# Releasing

How the maintainer releases the desktop app, the MCP server and the Claude
Code plugin. Each has its own version and its own steps. Tags and
publishing are done by hand.

## The desktop app

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and
published as GitHub Releases, where installed copies of Folio look for
updates (**Folio → Check for Updates…**, also checked quietly at launch).

1. With the release notes under `## [Unreleased]` in `CHANGELOG.md`, run from
   a clean, up-to-date `main`:
   ```bash
   node scripts/release.mjs patch   # or minor, major, or a version: 0.4.0
   ```
   It sets the version in `desktop/package.json` and `frontend/package.json`,
   updates their lock files, dates the changelog section, and commits it
   all on a `release-X.Y.Z` branch. Review it, push it and merge it to `main`.
   CI checks that every file has the same version
   (`node scripts/release.mjs --check`).
2. Tag that commit and push the tag:
   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```
3. The workflow checks the tag matches the version, creates a **draft**
   release with generated notes, and uploads:
   - macOS: `Folio-0.2.0-arm64.dmg` (Apple Silicon) and `Folio-0.2.0.dmg`
     (Intel), plus a `.zip` of each for the updater, signed with the
     Developer ID certificate and notarized
   - Windows: `Folio-Setup-0.2.0.exe` (unsigned for now — SmartScreen warns)
   - Linux: an AppImage
   - `latest*.yml` files the updater reads
4. Review the draft on GitHub (replace the generated notes with the version's
   `CHANGELOG.md` entry), then **Publish** it. Installed
   apps see the update from then on.

Signing and notarization use secrets in the repository's `release`
environment (tags `v*` only): `CSC_LINK` (the Developer ID `.p12`,
base64-encoded), `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8` (the App Store
Connect API key's `.p8` text), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
`.github/workflows/ci.yml` lints, type-checks and tests every push to `main`
and every pull request.

## The MCP server

The MCP server (`packages/mcp`) is published to npm as
`@crazzybot/folio-mcp`, by hand. It has its own version, separate from the
app's; `scripts/release.mjs` doesn't change it.

Once: own the `@crazzybot` scope on npm (the user or a free organisation of
that name), turn on two-factor authentication, and run `npm login`.

1. Set the new version in a pull request and merge it to `main`:
   ```bash
   cd packages/mcp
   npm version patch --no-git-tag-version   # or minor, major
   ```
2. From a clean, up-to-date `main`:
   ```bash
   cd packages/mcp
   npm ci
   npm publish --dry-run   # the files: LICENSE, README.md, package.json, dist/
   npm publish
   ```
   `prepublishOnly` type-checks, tests and builds `dist/`; `prepack` copies
   the repository's `LICENSE` into the package. `publishConfig` makes the
   scoped package public.
3. Check it starts from npm:
   ```bash
   npx -y @crazzybot/folio-mcp --help
   ```

## The Claude Code plugin

The plugin (`plugins/folio`) is served from this repository, which is also
its marketplace (`.claude-plugin/marketplace.json`): users get what's on
`main`. It runs the MCP server with `npx -y @crazzybot/folio-mcp`, so a new
server release needs no plugin release.

1. Change the plugin in a pull request, and raise `version` in
   `plugins/folio/.claude-plugin/plugin.json`: installed copies update only
   when it changes. Check both manifests:
   ```bash
   claude plugin validate .
   claude plugin validate plugins/folio
   ```
2. Try it in a project before merging:
   ```bash
   claude --plugin-dir path/to/folio/plugins/folio
   ```
3. Merge it to `main`. Users get it with `/plugin marketplace update folio`.
