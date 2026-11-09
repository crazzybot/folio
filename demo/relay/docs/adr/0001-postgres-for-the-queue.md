---
status: accepted
date: 2026-08-12
decision-makers: [Priya, Tomás]
tags: [queue, postgres]
---
# ADR 0001: Postgres for the delivery queue

## Context

Relay needs a durable queue for events that are waiting to be delivered.
Peak volume is about 3,000 events per second, and most endpoints answer
within a second. See [[queue-options|the queue research]] for the options we compared.

## Decision

Keep the queue in the Postgres database Relay already uses, with workers
taking events with `SELECT … FOR UPDATE SKIP LOCKED`.

## Consequences

- One less system to run, back up and monitor.
- Delivery order per endpoint is easy to keep: one worker holds an endpoint
  at a time.
- Postgres becomes the bottleneck at roughly ten times today's volume. We'll
  revisit when sustained volume passes 15,000 events per second.
