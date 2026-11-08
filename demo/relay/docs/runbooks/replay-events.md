# Runbook: replay events

Re-deliver events to an endpoint after an incident, for example when a
receiver lost events it had already acknowledged.

## Before you start

- Get the tenant's go-ahead: they will receive duplicates (see
  [[0002-at-least-once-delivery|ADR 0002]]).
- Find the endpoint id and the time window in the dashboard.

## Steps

1. Pause the endpoint so new events queue up behind the replay:

   ```bash
   relay endpoints pause ep_7Hq2
   ```

2. Replay the window, oldest first:

   ```bash
   relay events replay --endpoint ep_7Hq2 \
     --from 2026-11-03T14:00:00Z --to 2026-11-03T15:30:00Z
   ```

3. Watch the endpoint's queue depth fall to zero, then resume it:

   ```bash
   relay endpoints resume ep_7Hq2
   ```

## If the replay fails

Events stay in the queue and are retried with the usual backoff. Don't run
the replay twice: the second run queues every event again.
