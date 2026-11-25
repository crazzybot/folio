# Reviewing specs with a coding agent

Coding agents write specs, plans and decisions faster than anyone can read
them. Folio is the other end of that loop: the agent edits the files, you
read and mark them up in Folio, and your notes go back to the agent.

```
 agent writes / revises ──► Folio: read, mark up, decide
          ▲                              │
          └─────── review notes ◄────────┘
```

## A review round

1. **Open the folder** the agent writes to, and focus on the part you're
   reviewing.
2. **Read and mark up.** Highlight what's unclear or wrong and write a note
   on it. Give the document a status to ask for, such as `accepted`.
3. **Send your notes.** The header's clipboard button opens the Send dialog,
   with the notes not sent yet ticked. A note with replies says how many;
   they go with it. Copy them and paste them into the agent (Claude Code,
   Cursor or any other).
4. **Read the revision.** Folio shows the agent's edits as it saves them,
   and your marks follow the text.

<!-- TODO: a worked example: a spec, two notes, the copied text, the revision -->

## Connect the agent

Instead of copying and pasting, the agent can get your notes itself, through
Folio's MCP server, and answer each one in Folio. In Claude Code, install
Folio's plugin:

```
/plugin marketplace add crazzybot/folio
/plugin install folio@folio
```

Then run `/folio:review` in the project. The agent gets the notes you haven't
sent yet, revises the documents, and answers each note: what it changed, or
why not, or a question. Name documents to review only those:
`/folio:review docs/spec.md`.

Other agents (Cursor, Codex and any other MCP client) run the server with
`npx -y @crazzybot/folio-mcp`; see its
[setup](https://www.npmjs.com/package/@crazzybot/folio-mcp). It needs
Node 20.19 or later. The server reads your documents and never writes to
them; the agent edits them with its own tools.

**Settings → Coding agents** (`⌘,` / `Ctrl+,`) has both setups, each with
a **Copy** button.

## The agent panel

In the desktop app, Claude Code can run in a panel below or beside your
documents, so you don't need a separate terminal. Open it with **View → Toggle Agent
Panel** (`⌘J` / `Ctrl+J`) or the terminal button in the status bar. The
session starts in the workspace, or in the focused folder. To start it in
another folder, choose **Open Agent Here** in the folder's context menu.

- **Hide** closes the panel and keeps the session running; open it again to
  pick up where you were. **Restart** ends the session and starts a new
  one. Drag the panel's top bar to resize it. Folio keeps its size the
  next time you open it.
- **Bottom or right.** Choose **View → Agent Panel Position**, or click the
  button next to **Hide** to move the panel to the other side. On the
  right, it runs from the top of the window to the status bar; drag its
  left edge to resize it. If the window is too narrow for the panel beside
  your documents, it shows at the bottom until you make the window wider.
- **The review loop.** The header shows `/folio:review-loop` with a
  **Copy** button: paste it in the panel and press Enter, and Claude waits
  for the notes you send from Folio. Folio never types into the session.
  The header then shows **Waiting for your notes** or **Working on your
  notes**. Press Esc in the panel to stop waiting. The command needs
  Folio's plugin (above). On Windows, the header needs version 0.4.2 or
  later of Folio's MCP server.
- **Claude Code not found.** If Claude Code isn't installed, or your shell
  can't find `claude`, the panel says so and links to its install guide.
  Press any key to try again once it's installed.

## Review in a loop

Rather than going back to the agent after each round, you can leave it
waiting for your notes. In Claude Code, with Folio's plugin, run
`/folio:review-loop`. Other agents can do the same: ask them to wait for
your review notes with `folio_wait_for_review`, address them, and keep going
until you stop them. The agent only takes notes on documents in the folder
it works in.

- **Live** (desktop). A green **Live** pill in the status bar shows that an
  agent is waiting for your notes, whatever the sidebar shows. Point at it
  to see which agents, in which folders, and whether each is waiting or
  working on notes; click it for the same in a menu. A green dot marks the
  agent's folder in the document list and on a focused folder.
- **Send.** With an agent Live, the **Send review notes** dialog names it,
  and **Send** hands the ticked notes straight to it; there's nothing to
  paste. **Copy** is still there, for pasting elsewhere.
- **Send from the note** (desktop). With an agent Live on the document,
  the note editor and the reply box have **Send** (`⇧⌘↩` /
  `Ctrl+Shift+Enter`): that one note goes to the agent at once, without the
  dialog. On the note on the document, it's there while the note has
  changes or hasn't been sent. **Save** beside it keeps the note for the
  next round.
- **Wait for the answer.** After **Send**, the popover stays open, as in a
  chat. A pulsing dot shows the note waiting for the agent, then dots while
  the agent works on it, and its reply takes their place when it comes. If
  the loop ends first, the popover says so. Close it with **×** whenever
  you like: the reply is there when you open the note again.
- **Picked up.** Once the agent takes the notes you sent, they show it:
  "Sent · Claude Code has it" in the note's popover and on the note on the
  document, and "Claude Code is working on it" in the **Marks** view. Until
  then they're waiting for the agent.
- **End Review Loop.** In the status bar's **Live** pill menu, one for each
  agent, and **End All Review Loops** when there are several. Also in the
  context menu of the agent's folder. The agent stops waiting and tells you the loop has ended.
  You can also stop it in the agent itself. Quitting Folio ends the loop
  too, and so does opening a workspace that doesn't hold the agent's folder.

### Know when the agent replied

While you're in another app, a system notification says when an agent
answers your notes, such as "Claude Code replied to 4 notes", or asks you
something, such as "Claude Code asked 2 questions" (desktop). Click it to
come back to Folio with the first of those notes open. The Dock icon shows
how many notes have replies or questions you haven't read yet.

## Replies

The agent's answers show under each note: in the popover when you click a
highlight, and under the note on the document. Each reply has its author and
when it was written, in a box of its own; yours are tinted. Messages show
their Markdown formatting, such as bold, lists and code. Links show their
address when you point at them, but don't open, and images show only their
description.

- **New replies.** A note with replies you haven't read has a dot on its
  margin icon, and a **New reply** label in the **Marks** view. The status
  bar says who replied, such as "Claude Code replied to 3 notes"; click it to
  go to each note in turn. Opening a note marks its replies as read.
- **Inline notes.** With notes shown in the text (`⌥⌘N` / `Ctrl+Alt+N`),
  a note with replies has one line under it: how many, who wrote the latest
  and when, and **New** if some are unread. Click it to read the thread.
- **Rewritten passages.** When the agent rewrites the passage you noted,
  it can tell Folio which text replaced it. Folio then highlights the new
  text, and the note's popover shows the old one under **Before the edit**,
  struck through.
- **Deleted passages.** When the agent removed the passage you noted, the
  note moves beside the heading of its section. If that's gone too, it's
  listed above the document under **Not found in the current text**. Click
  it to read the agent's reply.
- **Addressed or answered.** When the agent changed the document for a
  note, its reply marks the note **Addressed**. A question, or an
  explanation of why it didn't change anything, marks it **Answered by …**:
  it waits for you, and isn't sent again until you reply.
- **Reply.** Click **Reply** under the agent's answer, and **Save** (`⌘↩` /
  `Ctrl+Enter`). Your reply opens the note again, so it goes with the next
  round, and the note closes. With an agent Live, **Send** sends it at
  once and keeps the note open for the answer. **Reply**
  shows only when the agent spoke last; until then, edit your own message.
- **Edit your reply.** Until someone answers it, your latest reply has an
  **Edit** link. **Save** (`⌘↩` / `Ctrl+Enter`) opens the note again, so
  the new wording goes with the next round.
- **Delete your reply.** Until it's sent, your latest reply has **Delete**
  too. The note goes back to how it was before your reply, **Addressed** for
  example. The bin at the top of the popover still removes the highlight
  with its whole conversation.
- **One conversation.** Once a note has replies, it's the first message of
  the thread, and the whole thread scrolls together. A note or reply that
  was answered can't be edited. On the note on the document, you can still
  change the **Status**. A conversation opens at its latest message, and
  scrolls down when a reply comes in.

## Questions from the agent

An agent can ask its questions in Folio instead of in its terminal: it puts
each one on the passage it's about, as a note. In Claude Code, with Folio's
plugin, run `/folio:draft` with what to write, such as `/folio:draft a spec
for the export feature in docs/specs/`: the agent writes it, puts every open
question on its passage, and waits for your review. In a review, the
plugin's agent asks its questions the same way. Other agents do it with
Folio's MCP server when you ask them to, for example "put your open
questions on the spec as notes".

- **In the text.** The agent's notes are highlighted like yours. The
  popover and the inline note name it: **Question from Claude Code**,
  **Decision from Claude Code** or **Comment from Claude Code**.
- **Questions.** Click **Reply**, write your answer and **Save**: it goes
  with your next notes, and the note closes. While the agent is Live,
  **Send** sends it at once and keeps the note open for the answer.
- **Decisions.** The note shows the agent's options as buttons, and
  **Reply**. Click an option, or **Reply** to answer in your own words,
  or both: pick an option and add a comment. Click the picked option again
  to take it back. **Save** (`⌘↩` / `Ctrl+Enter`) keeps your answer for
  your next notes and closes the note; with the agent Live, **Send**
  (`⇧⌘↩` / `Ctrl+Shift+Enter`) sends it at once. **Esc** cancels. Your answer shows
  in the conversation as your reply, the option you picked first. Once the
  agent answers, the options go: the note is a conversation like any other.
- **Choices in a reply.** On any note, the agent can answer with a
  question and options to pick from, such as "TypeScript and shell, or
  all five languages?". The options show as buttons under the
  conversation, and you answer as on a decision.
- **Comments** tell you something, such as an assumption the agent made,
  and need no answer. **Resolve** them once read.
- **Finding them.** The status bar says "Claude Code asked 3 questions";
  click it to open each in turn. A question you haven't opened has a dot on
  its margin icon, as a new reply does. The **Documents** list shows how
  many questions wait on you in each document, in a blue pill (such as
  **?2**). In the **Marks** view, the filter's **The agent's notes** lists
  only them.

The agent records your answers in the document, and marks each note
**Addressed**. You can't edit the agent's notes, but you can delete them
with the bin, like your own.

## What the agent receives

The copied text is Markdown. Each note has the document's file path and line
(`/path/to/spec.md:42`), its section, the quoted passage and your note,
followed by its replies so far, yours and the agent's.
Highlights without a note, and notes marked **Only me**, are never sent.

`⇧⌘C` / `Ctrl+Shift+C` copies the unsent notes without opening the dialog.
**Settings → Review notes** changes the instructions at the top of the text,
or turns them off. In the desktop app they're kept in `settings.json`, so an
agent that fetches your notes through Folio's MCP server gets the same ones.

## Sent notes

**Don't send these notes again**, on by default, marks the copied notes as
sent, so the next copy only has new ones. **Undo** in the status bar takes it
back.

<!-- TODO: tips for agent prompts that make good use of the notes -->
