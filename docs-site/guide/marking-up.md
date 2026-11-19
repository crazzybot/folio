# Highlights, notes and bookmarks

Marks are how you keep track of what you've read and what needs another
pass. They're kept in Folio's own folder, never in your documents, and they
follow the text when a document is edited.

## Highlights and notes

1. Select text in a document.
2. Pick one of four colours from the toolbar above the selection, or choose
   **Add note** to highlight it and write a note.
3. Click a highlight later to change its colour, edit its note or remove it.

`⇧⌘H` / `Ctrl+Shift+H` highlights the selection in the last colour used.

To note a whole section (a paragraph, list item, table or code block), hover
it and click the note button in the margin.

### Where a note is in the review

The bottom row of a note's popover says where the note is, with its icon:

- **Not sent**: it goes with the next notes you send.
- **Sent**: you sent it, and the agent hasn't answered yet. **Mark not
  sent** puts it back with the next round.
- **Answered by …**: the agent replied without changing the document, with
  a question or why it left the text as it was. **Reply** to it, or
  **Resolve** it. It isn't sent again until you reply.
- **Addressed**: the agent says it changed the document for it.
  **Resolve** it, or **Reopen** it.
- **Resolved**: you closed it.

**Only me**, the lock at the right of that row, keeps a note to yourself:
it's never sent and has no state. A highlight without a note is yours too,
unless you click **Send to agent** in its popover. [Reviewing specs with a coding agent](./review-loop)
explains the rounds.

## A note on the whole document

The note button in the header (a page with a speech bubble), beside the
bookmark, opens a note on the
document as a whole: an overall comment and a status to ask for, such as
`accepted` or `rejected`. It works as a highlight's note: the same bottom
row with **Only me**, and replies under it. **Save** waits until you change
something. With **Only me** on, the comment is never sent, but a status you
ask for still is.

The note is shown above the text, under the document's status. Once the
document has the status you asked for, it says so ("✓ Now accepted"), and
that status is no longer sent. A resolved note isn't shown there; it stays
in the **Marks** view.

## Bookmarks

Bookmark the open document with the header's bookmark button (`⌘D` /
`Ctrl+D`), or a section with the button beside a heading on hover.

## The Marks view

The sidebar's **Marks** tab lists the marks of every document in the
workspace, grouped by document. Filter it to bookmarks, or highlights and
notes, or by note state. **Only the open document** narrows it to the
document you're reading.

## When a passage is deleted

A highlight whose text is no longer in the document isn't deleted. It's
listed above the text under **Not found in the current text**, one line
each: its colour, its note's state, the start of the passage, struck
through, then the start of your note. A dot
means the agent replied and you haven't read it yet. Click it to open its
popover: read the conversation, reply, **Resolve** it, or remove it with the
bin.

Resolved notes and highlights without a note are counted at the end, such
as **2 more**; click to show them. Further down the document, the summary
line at the top of the view counts the notes not found, such as **2 notes
not found**: click it to see them. In the **Marks** view, these highlights
say **Not found in the current text**, and clicking one opens it above the
document.

## When documents move

A document moved or renamed without edits keeps its marks. Otherwise its
marks are listed under **Missing documents** in the Marks view, where you can
move them to another document or delete them. Nothing is deleted on its own.

After you switch git branches, a document that exists only on another branch
is listed under **On other branches** instead, with the branch's name. Its
marks stay as they are, and they're back when you switch back.
