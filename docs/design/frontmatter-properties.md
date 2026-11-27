# Front matter properties

Status: implemented (2026-11-27).

Folio reads four fields from a document's front matter (status, date,
decision makers, tags; see `frontmatter-metadata.md`) and hides the rest.
Front matter often says more than that: an owner, a ticket, links, a
version, review dates. Today a reader can't see those without opening the
file elsewhere, and a document whose front matter has none of the four keys
shows no sign of having any. This design lets the reader open the whole
front matter from the document header, as a table of properties or as the
YAML it is written in.

## Decisions

| Question | Decision |
|---|---|
| Where | In the **Document properties** strip above the text: a toggle at its end opens a panel under it, inside the header. Not a popover (it goes away while reading the text beside it), not in the article (text there counts in highlights' positions) |
| The toggle | Says what it hides: **4 more properties** (keys the strip doesn't show), or **Properties** when the strip shows them all. Open, it reads **Properties** |
| Front matter with none of the four keys | The strip shows the toggle alone, so front matter is never hidden without a sign |
| Views | **Table** (every top-level key, in source order) and **YAML** (the block as written). TOML front matter (`+++`) has the YAML view only, labelled **TOML** |
| Values | Plain text, selectable for copying. Not clickable as filters. http(s) URLs are links, opened as the viewer opens external links |
| Parsing | The core's front matter rules, extended to return every top-level key. Not a YAML library |
| Remembered | Open or closed, and the view, app-wide (`storage.ts`), not per document |
| Pinned bar | Front matter doesn't bring up the pinned bar on its own. When the bar is there, its details show the same strip, toggle and panel, sharing the one remembered state |
| Height | The panel's table scrolls within a cap; the pinned bar's details, open, are capped at 60% of the view |
| Notes | None on properties: they're outside the article. A comment on a value goes in the note on the document |
| Search | Front matter values aren't searched. Later, maybe |

## 1. The toggle

```
✓ Accepted · 2026-08-12 · Ana, Ben    #queue #postgres    ▸ 4 more properties
```

The count is the number of top-level keys other than the ones the strip
shows (`status`, `date`, `decision-makers` / `deciders`, `tags` / `tag`),
so the reader knows whether opening it is worth it. A document whose front
matter has only those keys still gets the toggle, as **Properties**: the
YAML view can show what the strip leaves out (a `status` written with a
comment, a list the parser cut).

A document with front matter but none of the four keys has no `meta`, and
the strip isn't rendered today. It is now, with the toggle alone:

```
▸ 3 properties
```

No front matter, no toggle.

The toggle is a button with `aria-expanded` and `aria-controls`, labelled
with its text (`4 more properties`). Its label is new: check
`scripts/media/*.mjs` doesn't need it, and add it there if the recording
should open the panel.

## 2. The panel

```
✓ Accepted · 2026-08-12 · Ana, Ben    #queue #postgres    ▾ Properties
┌─────────────────────────────────────────────────── Table | YAML ┐
│ status           accepted                                       │
│ date             2026-08-12                                     │
│ decision-makers  Ana · Ben                                      │
│ tags             queue · postgres                               │
│ owner            platform-team                                  │
│ jira             PLAT-1234                                      │
│ rfc              https://example.com/rfc/42                     │
│ review           reviewers:                                     │
│                    - carol                                      │
│                  due: 2026-12-01                                │
└─────────────────────────────────────────────────────────────────┘
```

Under the strip, in the reading column, in the reader's font at a smaller
size. Outside the article, like the strip, so highlights' text positions
don't count it.

**Table.** Every top-level key, in source order, including the ones the
strip shows: the table is the whole front matter, the strip its summary.
Keys in monospace, muted; values in the UI font.

- A scalar as written, unquoted (the comment after it removed, as the
  metadata rules do).
- A list (`[a, b]`, `a, b` or `- a` lines) as its items, separated by
  ` · `.
- Anything else (a nested map, a multi-line string, an anchor) as its raw
  lines, in monospace, indentation kept.
- An empty value as `—`, muted.
- A key repeated: each occurrence, in order (the metadata rules read the
  first; the table hides nothing).

**YAML.** The front matter block between the `---` lines, verbatim, in
monospace. Not highlighted: the viewer registers no YAML grammar, and the
block is short. The source of truth when the table reads something oddly.

**Switch.** A two-button segmented control (**Table** | **YAML**) at the
panel's top right, `aria-pressed` on each.

**Text, not Markdown.** Values are rendered as text nodes, never as
Markdown or HTML: front matter is as untrusted as the rest of the document.
A value that is one http(s) URL is a link, through the viewer's external
link handling; no other value is a link.

**Selecting.** Values and the YAML are selectable for copying.

**Height.** The panel shows up to about 16 rows (or lines of YAML), then
scrolls within itself, so a long front matter doesn't push the text a screen
down. In a narrow column (a phone, in the live demo) each key sits above its
value.

**Print.** Included when open.

## 3. Under the pinned bar

The pinned bar (`DocumentHeader.tsx`) appears once the header is scrolled
past, and only when the document has a status, a note, changes or notes not
found (`hasPinnedSummary`). Front matter doesn't add to that: the bar keeps
the document's state in sight, and an `owner` isn't state. A document with
front matter and none of those has no pinned bar; its properties are at the
top (`⌘↑` / `Ctrl+Home`).

When the bar is there, **Show details** opens the whole header under it, and
the header's strip has the toggle, so the properties are a second level:

```
⌄  ✓ Accepted · Changed: Retries                          the bar
⌃  ✓ Accepted · 2026-08-12 · Ana, Ben  ▸ 4 more properties   details open
   [Changed since you read it: Retries …]
⌃  ✓ Accepted · 2026-08-12 · Ana, Ben  ▾ Properties          properties open
   ┌ Table | YAML ┐ …
   [Changed since you read it: Retries …]
```

- **One state.** The header and the pinned details share the remembered
  open state and view: opening the properties in either opens them in both.
- **Height cap.** The open details are at most 60% of the view's height and
  scroll within themselves, so they never cover the whole document. The
  panel's own cap (section 2) still applies inside them.
- **Escape** closes the details, properties included, as it does today. It
  doesn't change the remembered state: the next **Show details** opens them
  with the properties as they were.

## 4. Parsing

`packages/core/src/frontMatter.ts` holds the rules the scanner reads
metadata with (`frontMatterFields`, `scalar`, `list`, moved out of
`scanner.ts`), and `frontMatterProperties`, which reads every key for display
with the same rules. It has no Node imports, so the frontend compiles it:

```ts
interface FrontMatterProperty {
  key: string;
  /** A scalar's text or a list's items; null when it's another form (see raw). */
  value: string | string[] | null;
  /** The key's lines as written, from its line to the next top-level key. */
  raw: string;
}

/** Top-level front matter keys, in order, repeated keys kept; null without front matter. */
export function frontMatterProperties(text: string): { format: "yaml" | "toml"; block: string; properties: FrontMatterProperty[] } | null;
```

- The block is what `FRONT_MATTER` (`headings.ts`) matches; TOML front
  matter (`+++`) is matched separately and has `block` only (no
  properties).
- Lines before the first top-level key (comments) belong to no key; they're
  in the YAML view only.
- Keys are any top-level key, quoted or not (`_draft`, `'key two'`), not
  only the ones the metadata rules match.
- Tested in `packages/core/test/frontMatter.test.ts`.

Worked out in the frontend from the opened document's content, which
includes its front matter. The scanner and `GET /api/documents` don't
change: the listing keeps `meta` to what the list and the filters need, and
`expected-scan.json` is untouched.

## 5. Testing

- Parser: each scalar and list form, a nested map and a multi-line string
  as raw lines, a repeated key, comments before the first key, TOML block
  only, no front matter.
- Toggle: the count, **Properties** when the strip shows every key, the
  toggle alone without known keys, none without front matter.
- Panel: table and YAML views, values as text (a value with `<b>` or
  `[x](y)` shown as written), a URL as a link, the height cap.
- Pinned details: the toggle there, the shared state, the 60% cap, Escape.
- Remembered open state and view across documents and restarts.
