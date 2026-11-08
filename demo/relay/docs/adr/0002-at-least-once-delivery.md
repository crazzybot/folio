# ADR 0002: At-least-once delivery

Status: accepted · 2026-08-19

## Context

Exactly-once delivery over HTTP would need receivers to take part in a
protocol most of them won't implement.

## Decision

Deliver every event at least once. Each event carries an `Idempotency-Key`
header that stays the same across retries, and receivers are expected to
ignore keys they have already processed.

## Consequences

- A receiver that times out after processing an event gets it again.
- The documentation for receivers must lead with idempotency.
