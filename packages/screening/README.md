# Screening baseline

Server-only package for a bounded official OFAC SDN import and deterministic wallet-address decisions. It has no database dependency. The gateway/worker must publish a fully validated snapshot and provider health atomically in private storage; failed refreshes preserve the previous snapshot for audit but mark required provider health unavailable. Every authorization/fulfillment/refund check must use current health and source state. Do not blindly reuse an earlier allowed decision after a source/policy change.

## Coverage

The importer extracts **only** `Digital Currency Address - ETH` identifiers from the current official legacy `SDN.XML`. The explicit platform rule conservatively matches those identifier strings against Whitechain EVM addresses. A match is a configured denial; it is not a claim that a same-text address on another chain has the same owner. No-match means **passed configured checks** within this narrow coverage. It does not establish lawful funds, source-of-funds tracing, indirect exposure, all sanctioned parties or all applicable jurisdictions.

Official provenance: [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service), [exact identifier matching FAQ](https://ofac.treasury.gov/faqs/594), [XML format support](https://ofac.treasury.gov/sdn-list-data-formats-data-schemas/frequently-asked-questions-on-advanced-sanctions-list-standard). The current download route was confirmed in the publisher's production site bundle, not copied from a third-party feed.

## API

- `parseOfacSnapshot(xml, { fetchedAt, now?, sourceUrl?, maxBytes? })`: validates the entire XML, record count, supported addresses, publication/fetch clock and provenance. Returns a JSON-safe `SourceSnapshot` with source hash, timestamps, declared coverage and normalized deduplicated addresses. `entryCount` is the supported identifier occurrence count; `recordCount` is all SDN records.
- `importCurrentOfac({ fetch?, now?, timeoutMs?, maxBytes? })`: fixed official publisher URL, total timeout and streamed 50 MiB cap. One redirect is permitted only to Treasury's dedicated public-published S3 bucket and the expected published `SDN.XML` path. Signed redirect URLs are never returned in snapshots/errors. DOCTYPE/entity declarations are rejected before parsing; external entity processing is disabled.
- `evaluateWallet({ address, snapshot, providerHealth, now?, maxSourceAgeMs?, decisionTtlMs?, internalDenials? })`: returns `allowed`, `blocked`, `review_required` or `unavailable`, reasons, evidence age and expiry. Required provider failure, unsupported/malformed/missing/stale/future data cannot allow. Invalid internal policy fails closed. Synthetic hard-denial fixtures belong in tests only.

Default source refresh interval: 1 hour. Maximum successful-fetch age: 2 hours. Decision TTL: at most 120 seconds and never beyond source expiry. Tighter per-call freshness settings are allowed; settings that broaden these bounds are rejected. These values are engineering policies, not legal safe harbors. `ProviderHealth.checkedAt` is the latest actual refresh/health outcome; never invent a heartbeat that did not access the source.

The caller persists private decision IDs, actual source/provider health and versions. Monetary operation bindings, signer authorization, policy synchronization and onchain enforcement are Phase 2 work; this module is not itself an execution-time router gate.

## Verification

From the repository root after the workspace install:

```powershell
pnpm exec vitest run packages/screening/tests/screening.test.ts
pnpm exec tsx packages/screening/scripts/probe.ts docs/evidence/phase-1/screening-source.json
```

The live probe writes only source URL/hash, timestamps, counts and honest coverage to evidence. It never publishes raw source identifiers or presigned URLs. Tests use synthetic addresses and injected clocks/fetch implementations; they are distinct from live source-read proof.
