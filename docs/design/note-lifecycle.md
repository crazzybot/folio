# Note lifecycle: states, and what the user can do in each

Status: implemented (2026-11-18). Replaces the state actions of
[sending-notes.md](sending-notes.md) §2 and the reply rules of
[agent-integration.md](agent-integration.md) where they differ.

A note goes through a review loop with an agent: the user writes it, sends
it, the agent answers or addresses it, and the user resolves it or answers
back. Before this doc, each state's popover offered actions that the
thread had made redundant or misleading:

- **Reply on the user's own note.** A note nobody had answered offered
  **Reply**, which only split the user's feedback in two, and locked the
  note against edits.
- **Editing a sent note didn't unsend it.** The new wording was saved, but
  the note stayed **Sent**: an agent that already had it never saw the
  change. Editing a reply already opened the note again.
- **Reopen and Mark not sent on an answered note.** Both sent the thread
  again with the agent's answer as its last word and nothing new from the
  user. The agent could only guess what was wrong.
- **Reopen on a resolved note** went to **Not sent**, not back to where the
  note was. It didn't undo a Resolve made by mistake.

## Decisions

| Question | Decision |
|---|---|
| When the user can **Reply** | Only when someone else spoke last: the agent, or an imported comment. The user's own last message is edited instead |
| What editing does | Any change to the user's wording (the note, their latest reply, or the note on the document's comment or status asked for) makes the note **Not sent**: new feedback goes with the next round |
| How a note goes back to the agent with a thread | A reply. There's no bare Reopen: the user says what's still missing |
| What **Unresolve** does | Goes back to the state Resolve took the note from, kept as `resolvedFrom` |
| **Mark not sent** | Only on a sent note the agent hasn't answered: a round that was lost, to send again as it is |

## 1. States

Four states are stored (`state` on a highlight or the note on the
document, [sending-notes.md](sending-notes.md) §1); **Answered** is shown,
not stored: a sent note whose latest reply is the agent's.

| State | Means | Waits on |
|---|---|---|
| **Not sent** (`open`, absent) | Goes with the next round | The user |
| **Sent** | The agent has it, no answer | The agent |
| **Answered** (`sent`) | The agent replied without changing the document: a question, or why it left the text | The user |
| **Addressed** | The agent says it changed the document for it | The user |
| **Resolved** | The user closed it | Nobody |

A private note (**Only me**) keeps its state, but it isn't shown or used.

## 2. Actions

One rule: **the last message is editable by whoever wrote it until the
other side answers, and Reply appears only when the agent spoke last.**

| State | The note | The thread | The status row |
|---|---|---|---|
| Not sent, no replies | **Edit** | — | — |
| Not sent, the user's reply latest | Locked | **Edit** and **Delete** the reply | — |
| Sent, no answer | **Edit** (makes it Not sent) | **Edit** the user's latest reply (makes it Not sent) | **Mark not sent** · **Resolve** |
| Answered | Locked | **Reply** | **Resolve** |
| Addressed | Locked | **Reply** | **Resolve** |
| Resolved | **Edit**, when it has no replies (makes it Not sent) | **Reply**, when the agent spoke last | **Unresolve** |

The note is locked once it has replies (it's the thread's first message,
[agent-integration.md](agent-integration.md)). On the note on the document,
the **Status** select stays; changing it is an edit.

## 3. Transitions

| From | Action | To |
|---|---|---|
| Not sent | Send (a round with **Don't send these notes again**, or **Send**) | Sent |
| Not sent | The agent replies (it had the note from a plain copy) | Answered, or Addressed |
| Sent | The agent replies | Answered |
| Sent, Answered | The agent replies with `addressed: true` | Addressed |
| Sent | **Edit**, **Mark not sent** | Not sent |
| Sent, Answered, Addressed | **Resolve** | Resolved |
| Answered, Addressed, Resolved | **Reply** | Not sent |
| Resolved | **Unresolve** | The state before Resolve |
| Not sent, after the user's reply | **Delete** the reply | The state before the reply (`reopened`) |
| Any | **Edit** the note or the latest reply | Not sent |

## 4. Store

- **`resolvedFrom`**, an optional field on a highlight and the note on the
  document: the state Resolve took the note from, absent for open. It's
  set when the note becomes resolved and read only while it is. Leaving
  resolved keeps it: a reply that reopened a resolved note, once deleted,
  makes the note resolved again, and Unresolve still knows where it was.
  Version 1 of the marks record, as the other loop fields
  ([marks.md](marks.md)).
- **Edits open the note.** `updateHighlight` with a `note` that differs
  from the saved one, and `setNote` with a comment or status asked for
  that differs, set the state to open unless the request gives a state.
  Changing only the colour or the privacy keeps the state.
- The demo's store (`frontend/src/demo/marks.ts`) follows the same rules.
- The MCP server is unchanged: it never edits or resolves notes.

## Alternatives

- **Keep Reopen without a reply.** It made sense before threads: the note
  was the only message, and sending it again was the only way to say
  "not done". With replies, a bare reopen sends no reason.
- **Lock a sent note instead of opening it on an edit.** Safer about what
  the agent has seen, but the user can't fix a typo or add a thought before
  the agent picks the note up. Opening it again sends the new wording, as
  editing a reply already did.
- **Unresolve to Not sent.** Simpler (no new field), but it isn't an undo:
  an addressed note resolved by mistake would be sent again.
