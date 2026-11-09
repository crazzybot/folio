---
status: superseded by ADR-0005
date: 2026-08-26
decision-makers: [Priya, Tomás]
tags: [delivery, retries]
---
# ADR 0004: Retry on a fixed schedule

## Context

A delivery that fails has to be tried again, and tenants want to know how
long Relay keeps trying.

## Decision

Retry every 5 minutes, up to 24 times, then mark the event as failed.

## Consequences

- Easy to explain: "two hours, every five minutes".
- A receiver that comes back after an outage gets every waiting event at the
  same moment, and often falls over again. Replaced by
  [[0005-exponential-backoff|ADR 0005]].
