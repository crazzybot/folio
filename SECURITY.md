# Security Policy

Folio opens Markdown from folders that may contain untrusted content (cloned
repositories, downloaded notes), so security reports are taken seriously.

## Supported versions

Only the latest release receives security fixes. Installed copies of the
desktop app update themselves from GitHub Releases.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
[Report a vulnerability](https://github.com/crazzybot/folio/security/advisories/new).

Include what you can of:

- the affected component (desktop app or live demo) and version
- steps to reproduce, ideally with a sample Markdown file or workspace
- the impact you see (e.g. script execution, reading files outside the
  workspace, opening an executable)

You should get an acknowledgement within a few days. Once a fix is released,
the advisory is published with credit to you, unless you prefer otherwise.

## Scope

Especially of interest:

- script execution from a rendered document (sanitizer or CSP bypass)
- reading or serving files outside the workspace, or of non-allowlisted types
- escaping Electron's sandbox / context isolation, or abusing the IPC bridge
- getting the app to launch an executable or script from a link

The design behind these protections is described below.

## How Folio protects you

Markdown files are treated as untrusted — a workspace may contain cloned
repositories or vendored packages.

- **Rendering** — raw HTML in documents is filtered through GitHub's
  allow-list (`rehype-sanitize`): no scripts, event handlers, styles, frames,
  forms, `<meta>`/`<base>` or `javascript:` URLs. A Content-Security-Policy
  (set by the desktop app's `app://` handler) is the second layer.
- **Files** — only `.md`/`.markdown` files inside the workspace are served,
  by ID rather than path; symlinks pointing outside the workspace are ignored.
  Images and linked files are served by path, but only allowlisted types
  (images; documents, data, office files and media — never HTML, scripts,
  executables, launchers, archives or macro-enabled Office files) inside the
  workspace and outside skipped folders, with a sandboxing CSP so nothing
  served can run scripts. The desktop app opens linked files in their default
  app under the same allowlist, checked again after resolving symlinks.
- **Your marks** — highlights, notes, bookmarks and read records are kept
  in `~/.folio`, never in the workspace, which Folio never writes to. A
  damaged marks file, or one written by a newer Folio, is left untouched.
- **Git** — only read-only commands, run without a shell and with a
  timeout; not even git's index is refreshed.
- **Desktop** — context isolation and sandboxing, IPC limited to the app's own
  page, external links opened only for `http(s)`/`mailto`, all permission
  requests denied, and Electron fuses (no `ELECTRON_RUN_AS_NODE`,
  `NODE_OPTIONS` or `--inspect`; ASAR integrity checks) in packaged builds.
