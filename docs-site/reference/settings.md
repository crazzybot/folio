# Settings

Open the settings panel with **Folio → Settings…** on macOS or **File →
Settings…** on Windows and Linux (`⌘,` / `Ctrl+,`), or with the gear at the
start of the status bar. It has the appearance, document style,
reading width, font size, the sidebar and the outline. In the desktop app it
also has the workspace folder, skipped folders, scan depth, your editor,
custom CSS, review notes and coding agents.

## settings.json

The desktop app keeps its settings in `settings.json`. **Open settings.json**
at the foot of the settings panel opens it. Folio applies a change as soon
as you save the file.

| Platform | Folder |
|---|---|
| macOS | `~/Library/Application Support/Folio/` |
| Windows | `%APPDATA%\Folio\` |
| Linux | `~/.config/Folio/` |

```json
{
  "workspace": "/Users/me/notes",
  "skipDirs": [".git", "node_modules", ".venv", "…"],
  "maxDepth": null,
  "theme": "system",
  "editor": null,
  "reviewIntroOn": true,
  "reviewIntro": ""
}
```

| Setting | What it does |
|---|---|
| `workspace` | The folder Folio opens. |
| `skipDirs` | Folder names skipped wherever they appear. |
| `maxDepth` | How many folder levels below the workspace are scanned: `docs/guide.md` is depth 1. `null` scans every level. |
| `theme` | `"system"`, `"light"` or `"dark"`. The ◐ menu sets the same value. |
| `editor` | The editor for **Open in Editor**. On macOS, an app name such as `"Visual Studio Code"` or `"Cursor"`; on Windows and Linux, a command on the `PATH`, such as `"code"`. |
| `reviewIntroOn`, `reviewIntro` | **Settings → Review notes**: whether review notes start with instructions for the agent, and their wording. `""` uses the default; `{documents}` stands for the file name or "3 documents". Folio's MCP server reads them too. |

### Skipped folders

The default `skipDirs` covers version control, dependencies, virtual
environments, caches and tool data: `.git`, `node_modules`, `.venv`, `venv`,
`__pycache__`, `.cache`, `.local`, `.tox`, `.nox`, `.mypy_cache`,
`.pytest_cache`, `.ruff_cache`, `.next`, `.nuxt`, `.svelte-kit`, `.yarn`,
`bower_components`, `.terraform`, `Pods` and `.gradle`.

It leaves out `dist`, `build`, `vendor` and `target`, because some projects
keep real documentation there. Add them if yours don't.

### Your editor

With `editor` left at `null`, macOS uses the first of these that's
installed: Visual Studio Code, Cursor, Zed, Windsurf, Sublime Text, BBEdit,
Nova, Typora, iA Writer and MarkText. Otherwise it uses the default text
editor. Windows and Linux use the default app for Markdown files.

## Custom CSS

In the desktop app, **View → Edit Custom CSS…** opens `custom.css` in your
editor. Folio creates it from a commented template the first time. It
applies on top of the chosen document style, and changes show as soon as you
save. Target the document with `.folio-document`; to change only one style,
use `[data-doc-style="book"] .folio-document` (or `default`, `compact`).

## What Folio remembers

Between launches, the desktop app remembers the window's size and position,
and how you left the view: the sidebar's width, the folder tree and which
folders are open, the outline, reading width, font size and the full-text
search toggle. These files sit beside `settings.json` and aren't meant to be
edited by hand.

The live demo remembers the appearance, reading width and font size in your
browser.
