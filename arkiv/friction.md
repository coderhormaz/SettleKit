# Arkiv integration feedback

Phase 1 observations, 6 November 2026. This file records actual work and is not a message sent to the sponsor.

- The current Rabdi docs and SDK schema API agree: `defineSchema`, a `rabdi({ accessKey })` chain factory, typed `select(...).from(...).ownedBy(...)`, and explicit expiry are available in SDK `1.0.1`.
- The public endpoint served a real SDK owner-filtered feasibility query on chain `7794095`, returning zero rows for our new writer. An actual headless Chromium browser repeated that exact query directly from a separate local origin, with no gateway API or private browser credential. `arkiv-browser.json` records the result.
- The unfunded writer has zero tGLM, and the user has deferred funding, so a real write/read round trip remains pending. The SDK warns clearly when no access key is supplied; the free Hub access key and faucet wallet/account steps need to be completed outside a build script.
- The read/query result is not evidence of a created receipt, complete history or payment accounting. No entity key has been invented.

Reproduce using `packages/feasibility/src/arkiv.ts`; see `docs/evidence/phase-1/arkiv-network.json` for the actual writer/query and pending write gate. Further feedback will be added only after real write/expiry behavior is exercised.

Phase 4 implementation observations:

- SDK 1.0.1 intentionally treats bare hexadecimal strings as strings, not `key` or `addr`. Our first typed writer compile failed until receipt values explicitly used `key()`, `addr()`, `u64()` and `u256()`. A complete receipt-style schema example showing tagged write inputs alongside tagged query predicates would help.
- `expiresAt` is a block height. We preserve it as such and use actual `getBlockTiming()` reads for renewal thresholds. The actual public read returned a 2-second block duration; no signed extension behavior has been tested.
- Entity prediction includes an owner nonce. A deterministic salt alone is insufficient after a mapping crash; exact event-version queries and durable writer serialization are necessary. The SDK's source documents this accurately, but an end-to-end idempotent indexer example would make the operational implication clearer.
- Keyset pagination with `asc('$key')`/`gt('$key',key(cursor))` avoids offset shifts under new writes. Owner/creator filters and actual public typed queries work on the current Rabdi endpoint. Public endpoint rate limiting remains an honest availability constraint.

Reproduce the real empty receipt query with `node --import tsx packages/arkiv/scripts/public-read.ts`; its sanitized result is `packages/arkiv/evidence/public-read.json`. No sponsor message has been sent, and write/funding/renewal proof remains pending.
