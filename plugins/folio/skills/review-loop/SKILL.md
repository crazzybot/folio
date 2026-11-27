---
name: review-loop
description: Wait for the user's review notes from Folio, address them and answer each one, then wait for the next round, until the user says stop
---

# Review in a loop with Folio

The user reviews this project's Markdown documents in Folio. Rather than
coming back here after each round, they send their notes from Folio, and you
pick them up as they arrive.

1. Call `folio_wait_for_review` with no `since` and `timeoutSeconds: 60`.
   Tell the user once, before the first call, that you're waiting for notes
   sent from Folio, and that they can still ask you for anything else here.
2. When it returns without notes, call it again with the `since` it gave
   you and the same timeout. Don't say anything to the user between these
   calls. The waits are short so that a message the user types meanwhile
   reaches you within a minute.
3. When it returns notes, address them as `/folio:review` does:
   - Revise each document with your own editing tools. Keep its structure
     and language, and change only what the notes ask for. When a note
     changes a document's status, change its status line.
   - Answer every note with `folio_reply`, in a sentence or two: what you
     changed, with `addressed: true`; or why you didn't, or a question, with
     `addressed` left out. A question that's a choice gives 2 to 4 short
     `options`; a question about another passage goes on that passage with
     `folio_add_notes`. When your edit replaced the quoted text, give the
     new text as `passage`, copied exactly from the file. An answer you
     recorded in the document counts as a change: set `addressed: true`, and
     say what you changed, never that the note is resolved (the user
     resolves notes in Folio).
   - Then say in one line what you changed, and call `folio_wait_for_review`
     again with the `since` it gave you.
4. A message from the user doesn't end the loop. When they ask for
   something else, whether while you wait or by interrupting you ("run the
   tests", "implement the next phase"), do it, then say in one line that
   you're waiting for notes again and call `folio_wait_for_review` with the
   last `since` you had: notes sent in the meantime still come.
5. Stop when the user tells you to stop the loop, or when a wait says the
   loop has ended.
