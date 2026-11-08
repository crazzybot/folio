# Relay

Relay delivers webhooks for the Courier platform: it queues events, signs
them and retries until the receiver accepts them.

This is a **sample repository for the Folio demo**. Its documents were
written the way coding agents write them: confident, complete-looking and
worth a careful read. Try highlighting a claim you doubt, add a note, and
copy your notes for the agent from the clipboard button in the header.

## Where to start

- [[delivery-queue|Offline delivery queue]]: the spec under review
- [[rate-limits|Per-tenant rate limits]] and [[signed-payloads|Signed payloads]]
- Decisions so far: [[0001-postgres-for-the-queue|ADR 0001]],
  [[0002-at-least-once-delivery|ADR 0002]], [[0003-hmac-signatures|ADR 0003]]
- Background: [[queue-options|Research: queue options]]
- When something goes wrong: [[replay-events|Runbook: replay events]]

## Layout

| Folder           | What's in it                            |
|------------------|-----------------------------------------|
| `docs/specs`     | Feature specs, one per change           |
| `docs/adr`       | Architecture decision records           |
| `docs/research`  | Comparisons and spikes behind decisions |
| `docs/runbooks`  | Step-by-step operational procedures     |
