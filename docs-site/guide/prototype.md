# From spec to prototype

For a small project or a proof of concept, the whole cycle can run through
the documents: Claude Code drafts the spec and the plan, you decide, it
implements the plan, and you change the code by changing the spec. You
review the decisions in Folio; the code stays the agent's work, and you
read it only when you want to.

```
 draft ──► decide ──► implement ──► try it
   ▲                                  │
   └──────── revise the spec ◄────────┘
```

This suits prototypes and small tools. For a large codebase, review the
code itself in your editor or the pull request; Folio shows the documents,
not the code.

## What you need

- The desktop app, with Claude Code installed and logged in.
- Folio's plugin in Claude Code (see
  [Connect the agent](./review-loop#connect-the-agent)).
- A folder for the project. It can be empty.

Open the folder in Folio, then open the agent panel with **View → Toggle
Agent Panel** (`⌘J` / `Ctrl+J`). Claude Code starts in the folder.

## 1. Draft

Ask for the documents with `/folio:draft`, for example:

```
/folio:draft a spec, the ADRs and a plan with task lists for a small
browser game: <your idea>
```

Claude Code writes them and puts every open decision on the passage it's
about, as a note. The new documents show in the **Documents** list, and the
status bar says how many questions it asked. Then it waits for your review.

## 2. Decide

Read the documents and answer the agent's notes: pick an option on a
decision, answer a question in words, mark up anything else you'd change.
When a document is ready, ask for it to be accepted in the
[note on the whole document](./marking-up#a-note-on-the-whole-document).
**Send** your notes; the agent records each answer in the documents and
replies on the note. Repeat until the spec and the plan say what you want.

## 3. Implement

Ask the agent to carry out the plan with `/folio:implement`, for example
`/folio:implement phase 1 of docs/plan.md`.

- **Follow it in the plan.** It ticks each task's checkbox as soon as the
  task is done; Folio shows the plan as it changes.
- **Answer its questions in Folio.** A question that comes up goes on the
  task in the plan, or on the spec passage it's about. When it's about
  code, the note quotes the lines with the file's path, so you can answer
  without opening the file.
- **Decide on changes to the spec.** When the code can't follow the spec,
  the agent asks you with a decision on the passage, rather than changing
  the spec or quietly departing from it.

The agent goes on with the tasks that don't depend on an open question.
When it's done, it waits for your answers as in a
[review loop](./review-loop#review-in-a-loop), then carries on with the
tasks they unblocked. Claude Code still asks for permission to run commands
in the panel: answer there.

## 4. Try it, and revise the spec

Ask for what you want in the panel, such as "run the game". The agent does
it, then goes back to waiting for your notes.

What you'd change goes on the spec, as a note on the passage it's about:
"the pieces fall too slowly" on the passage that sets the speed. Send it.
The agent revises the spec, and the next `/folio:implement` builds it. The
documents keep every decision, so the spec describes the project as it is.
