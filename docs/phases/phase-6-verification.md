# Phase 6 verification and completion pass

Authorized by the user's 7 November instruction to check every phase, complete missing features, run the app and fix errors/failure points. This supersedes the earlier test deferral. Main agent only. Funding and public hosting remain deferred; recheck read-only availability without repeated funding requests.

## Work plan and exit checks

1. Inventory all phase requirements against current source, routes, migrations, visible controls and evidence. Preserve design/security/data invariants and actual proof boundaries.
2. Run pinned root unit/real-isolated-Neon and local contract suites, then production builds/type/import checks. Fix failures with meaningful regressions; do not weaken assertions to conceal bugs.
3. Exercise the extended local EVM + actual HTTP/Neon payment/refund/internal-collection harness. Complete missing real CRE recovery harness/unsafe-state tests, execute the actual CLI where accessible and preserve sanitized hashes/outcomes. Local chain/mock token remains labeled.
4. Exercise publication/correction/version/lease repair, recovery auth/caps/current-state races and JS/Python adapter paths. Use isolated data and bounded local failure fixtures, never production/customer funds.
5. Start the actual local services, run browser interactions at desktop/tablet/mobile, inspect screenshots/keyboard/errors and fix UI findings under the existing graphite/mint design. Leave a usable local runtime where possible.
6. Verify local supervisor and safe backup/isolated restore with existing installed tools and an explicitly isolated empty target if available. Check source freshness and read-only live network/funding state without implying signed writes.
7. Refresh implementation audit, per-phase gates, evidence and memory with actual results; secret review, normal Git fetch/push and remote verification after coherent fixes.

Money stays integer base units. Required screening, onchain policy, original-payer refunds, tenant isolation, atomic private transitions/outbox, fenced jobs, source-verified public receipts and receiver-side logical fulfillment remain mandatory. Current state wins over stale recovery events. Human narration/live funded evidence cannot be invented or replaced with local tests.
