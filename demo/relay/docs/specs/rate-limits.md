---
title: "Spec: per-tenant rate limits"
status: accepted
---
# Spec: per-tenant rate limits

## Summary

Each endpoint gets a token bucket, so one tenant's burst of events can't
slow deliveries for everyone else. Deliveries over the limit wait in the
queue; they are never dropped.

## Token bucket

A bucket holds up to $b$ tokens and refills at $r$ tokens per second. A
delivery takes one token. After an idle period of $t$ seconds the bucket
holds

$$
\min(b,\; n + r \cdot t)
$$

tokens, where $n$ is what it held before. A burst of $b$ deliveries goes out
at once; after that, deliveries go out at $r$ per second.

## Limits by plan

| Plan       | Rate $r$ (per s) | Burst $b$ |
|------------|------------------|-----------|
| Free       | 5                | 20        |
| Team       | 50               | 200       |
| Enterprise | 500              | 2000      |

Limits apply per endpoint, not per tenant, so a tenant with ten endpoints on
the Team plan can send 500 deliveries per second in total.

## Receivers that ask for less

A receiver that answers `429 Too Many Requests` with a `Retry-After` header
gets nothing more until that time has passed, whatever its bucket holds.

## Open questions

- Should Enterprise tenants be able to raise their own limits?
