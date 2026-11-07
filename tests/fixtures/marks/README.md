Shared fixtures for the two marks stores (`backend/app/marks.py` and
`desktop/src/marks.ts`); both test suites read them.

- `records/*.json` — saved records. `{WORKSPACE}` in `path` stands for the
  fixture workspace's real path; tests substitute it before copying the
  records into a temporary data folder.
- `expected-listing.json` — what listing the fixture workspace's marks
  returns for those records (`docId` is the document's id).
- `invalid-highlights.json` — `[description, body]` pairs both stores must
  refuse when adding a highlight.
