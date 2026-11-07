# Security Policy

Folio opens Markdown from folders that may contain untrusted content (cloned
repositories, downloaded notes), so security reports are taken seriously.

## Supported versions

Only the latest release receives security fixes. Installed copies of the
desktop app update themselves from GitHub Releases.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
[Report a vulnerability](https://github.com/crazzybot/markdown-viewer/security/advisories/new).

Include what you can of:

- the affected component (desktop app, browser frontend, backend API) and version
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

The design behind these protections is described in the
[Security section of the README](README.md#security).
