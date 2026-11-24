---
name: draft
description: Write or revise Markdown documents for the user to review in Folio (specs, ADRs, plans, notes), putting every open question and decision on the passage it's about as a note, then wait for their review
argument-hint: "[what to write]"
---

# Draft documents for review in Folio

The user reads and reviews this project's Markdown documents in Folio.
Write the documents they ask for, and instead of listing your open
questions in the conversation, put each one in Folio on the passage it's
about: the user answers it there, next to the text.

What to write: $ARGUMENTS

1. Write or revise the documents with your own editing tools, in the
   project's own style and structure (its templates, folders, status
   lines). Where something is undecided, write your best proposal in the
   text, so there's a passage to ask about.
2. Put every open point on its passage with `folio_add_notes`, one call
   per document:
   - `decision` when it's a choice: 2 to 4 short `options`, the one you
     propose first. The user picks one with a click.
   - `question` when it needs an answer in words.
   - `comment` for an assumption the user should know about, which needs
     no answer.

   Copy each `passage` exactly from the file: a phrase or a sentence,
   unique in the document. Keep notes to what the user must decide about
   the content; don't ask permission for actions there.
3. Tell the user in one or two lines what you wrote and how many notes you
   left, and that they can answer them in Folio. Then wait for their
   review as `/folio:review-loop` does, and record each answer in the
   document when it comes back.

Questions that come up later, while you implement what the documents
describe, go on the passage of the spec or plan they're about too, so the
documents keep every decision.

If `folio_add_notes` isn't available (an older Folio MCP server), ask your
questions in the conversation instead, each with the passage it's about.
