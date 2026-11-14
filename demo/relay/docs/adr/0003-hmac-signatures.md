# ADR 0003: HMAC signatures

Status: proposed · 2026-10-02

## Context

Receivers need to check that a delivery came from Relay. The options are a
shared-secret HMAC or a public-key signature such as Ed25519.

## Decision

Sign with HMAC-SHA256 and a secret per endpoint (see [[signed-payloads|the signed payloads spec]]).
Each endpoint can hold two secrets at once, so a tenant can rotate without
a gap.

## Consequences

- Every mainstream language verifies an HMAC with its standard library.
- The secret has to be shown to the tenant once and stored by them; a leaked
  secret lets anyone forge deliveries to that endpoint until it's rotated.
- Rotating takes a tenant about ten minutes today: create a second secret,
  deploy it, then revoke the first. Both secrets verify for 24 hours, so
  deliveries keep passing while the receivers change over.
- Public keys would avoid that, at the cost of a key-distribution story we
  don't have yet.
