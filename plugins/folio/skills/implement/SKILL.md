---
name: implement
description: Implement the tasks of a plan the user reviews in Folio, ticking each one in the plan as it's done, and putting the questions that come up on the plan or spec passage they're about, with the code they concern, then wait for their review
argument-hint: "[plan, phase or tasks]"
---

# Implement a plan reviewed in Folio

The user reviews this project's specs, ADRs and plans in Folio. Implement
what they describe, and keep the documents the place where decisions are
made: the user follows your progress in the plan, and answers your
questions next to the text they're about, not in the conversation.

What to implement: $ARGUMENTS

1. Find the tasks: the plan, phase or tasks named above, or else the
   project's plan. If it isn't clear which, ask in one line here. Read the
   plan, and the specs and ADRs it builds on.
2. Work through the tasks in the plan's order. When a task is done, tick
   its checkbox in the plan (`- [ ]` to `- [x]`) at once, not at the end:
   Folio shows the plan as it changes. Change nothing else in the plan for
   that.
3. Put each question that comes up on the passage it's about with
   `folio_add_notes`, as `/folio:draft` does: on the task in the plan, or
   on the requirement or decision it concerns in the spec or an ADR.
   - `decision` when it's a choice: 2 to 4 short `options`, the one you
     propose first. `question` for an answer in words. `comment` for an
     assumption you made, which needs no answer.
   - When it's about code, a test or any other file, quote the lines it's
     about in the note, as a fenced code block under the file's path and
     lines (`src/board.ts:41-48`). The user reads documents in Folio, not
     your files: they should be able to answer without opening one. Quote
     only what the question needs, 20 lines at most.
4. Don't stop at a question. If the answer would be easy to change later,
   go on with your proposal and say so in the note. Otherwise set that task
   aside and go on with the tasks that don't depend on it.
5. When the code has to differ from what a spec or ADR says, don't change
   the document to match the code, and don't quietly diverge from it: put a
   `decision` on the passage, with keeping the document and changing it
   among the options. Revise the document once the user has decided.
6. Leave in the conversation what belongs there: running a command,
   approvals, a build you're fixing. Notes are for decisions the documents
   should keep.
7. When you're done, or every task left waits on an answer, say in one or
   two lines what you did: the tasks you ticked, and the notes you left.
   Then wait for the review as `/folio:review-loop` does. When answers come
   back, record each in its document and answer the note with
   `folio_reply`, as in a review, then carry on with the tasks they
   unblocked, ticking them as before.

If `folio_add_notes` isn't available (an older Folio MCP server), ask your
questions in the conversation instead, each with the document and passage
it's about.
