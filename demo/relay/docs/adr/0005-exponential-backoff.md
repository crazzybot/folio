---
status: accepted
date: 2026-09-15
decision-makers: [Priya]
tags: [delivery, retries]
---
# ADR 0005: Exponential backoff with jitter

## Context

Retrying on a fixed schedule ([[0004-retry-on-a-fixed-schedule|ADR 0004]])
sends a receiver's whole backlog at once when it recovers.

## Decision

Wait 30 seconds after the first failure and double the wait after each
one, up to an hour, with up to 20% random jitter. Give up after 24 hours.

## Consequences

- A recovering receiver sees its backlog spread out instead of in one burst.
- The retry schedule is harder to describe; the delivery log shows the next
  attempt's time for each event.
