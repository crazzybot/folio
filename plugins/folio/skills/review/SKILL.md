---
name: review
description: Address the review notes the user left in Folio on the project's Markdown documents, then answer each note in Folio
argument-hint: "[paths…]"
---

# Address Folio review notes

The user reviewed Markdown documents in this project with Folio and left
notes on them: comments on quoted passages, and notes on whole documents.
Address them, and answer each one in Folio, where the user reads your
replies next to the passages.

Documents to review: $ARGUMENTS

1. Call `folio_get_review_notes`. If documents are named above, pass them as
   `paths`; otherwise leave `paths` out to get every document with notes
   not yet sent to you. If there are none, say so and stop.
2. Revise each document to address its notes, with your own editing tools.
   Keep the document's structure and the language it's written in. Change
   only what the notes ask for; when a note changes a document's status,
   change the status line in the document.
3. Answer every note with `folio_reply`, in a sentence or two:
   - what you changed, with `addressed: true`;
   - or why you didn't change it, with `addressed` left out;
   - or a question, with `addressed` left out, so the note stays open.

   Don't leave a note unanswered, even when the passage it quotes is gone.
4. Finish with a short summary: the documents you changed, the notes you
   addressed, and the ones left open. Suggest the user review the changes
   in Folio, where they resolve or reopen each addressed note.
