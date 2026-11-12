# Markdown support

## GitHub Flavored Markdown

Tables, task lists, strikethrough and syntax-highlighted fenced code blocks.
Code blocks have a copy button on hover.

## Front matter

YAML front matter is hidden. Folio reads these fields from it:

| Field | Used for |
|---|---|
| `title` | The document's name in the list |
| `status` | The status icon, filters and the line above the document |
| `tags` | Filters and the hover card |

<!-- TODO: the full list (date, decision makers, superseded by), with an example -->

## Obsidian links and embeds

- `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` and `[[#Heading]]` links,
  resolved by file name anywhere in the workspace, nearest first.
- `![[image.png|300]]` image embeds.

## Math

KaTeX: `$E=mc^2$` inline, and `$$…$$` or ` ```math ` blocks. Inline math
follows GitHub's rules, so prices like "$5 and $10" stay text.

## Mermaid diagrams

` ```mermaid ` blocks are drawn in the current light or dark theme. Hover a
diagram and click its expand button, or double-click it, to view it in the
whole window with zoom and pan.

## Images and links

- Images from the workspace, relative to the document, and from the web.
- Links to other files, such as `[data](report.pdf)`, open in their app.
  Links to scripts, executables and HTML are shown as unavailable.
