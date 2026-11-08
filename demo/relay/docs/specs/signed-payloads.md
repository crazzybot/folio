---
title: "Spec: signed payloads"
status: accepted
---
# Spec: signed payloads

## Summary

Every delivery carries a signature, so a receiver can check that it came
from Relay and wasn't changed on the way. See [[0003-hmac-signatures|ADR 0003]] for
why it's an HMAC rather than a public-key signature.

## The header

```http
X-Relay-Signature: t=1730918400,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

- `t` is the Unix time the delivery was signed.
- `v1` is the HMAC-SHA256 of `t`, a dot and the raw body, keyed with the
  endpoint's secret, in hex.

## Verifying a signature

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(header: string, body: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Receivers should also reject signatures older than five minutes, so a
captured delivery can't be replayed later.

## Rotating a secret

During a rotation both secrets are valid for 24 hours, and deliveries carry
two `v1` values, one per secret.
