---
name: review-loop
description: Wait for the user's review notes from Folio, address them and answer each one, then wait for the next round, until the user says stop
---

# Review in a loop with Folio

The user reviews this project's Markdown documents in Folio. Rather than
coming back here after each round, they send their notes from Folio, and you
pick them up as they arrive.

1. Call `folio_wait_for_review` with no `since`. Tell the user once, before
   the first call, that you're waiting for notes sent from Folio, and that
   they can interrupt you to stop.
2. When it returns without notes, call it again with the `since` it gave
   you. Don't say anything to the user between these calls.
3. When it returns notes, address them as `/folio:review` does:
   - Revise each document with your own editing tools. Keep its structure
     and language, and change only what the notes ask for. When a note
     changes a document's status, change its status line.
   - Answer every note with `folio_reply`, in a sentence or two: what you
     changed, with `addressed: true`; or why you didn't, or a question, with
     `addressed` left out.
   - Then say in one line what you changed, and call `folio_wait_for_review`
     again with the `since` it gave you.
4. Stop when the user tells you to, or interrupts you.
