Shared fixtures for the two marks stores (`backend/app/marks.py` and
`desktop/src/marks.ts`); both test suites read them.

- `records/*.json` — saved records. `{WORKSPACE}` in `path` stands for the
  fixture workspace's real path, and `{SHA1 <location>}` / `{SIZE <location>}`
  in `fingerprint` for that document's; tests substitute them before copying
  the records into a temporary data folder, each named by its record id.
  `moved`, `renamed` and `gone` are files that no longer exist: moved without
  edits (its marks move to `docs/html-title.md` by themselves), renamed and
  edited (`docs/front-matter-untitled.md` is suggested), and deleted.
- `expected-listing.json` — what listing the fixture workspace's marks
  returns for those records; `{ID <location>}` stands for that document's id
  and `{RECORD <location>}` for the record id of a missing file there.
- `invalid-highlights.json`, `invalid-bookmarks.json` — `[description, body]`
  pairs both stores must refuse when adding a highlight or a bookmark.
