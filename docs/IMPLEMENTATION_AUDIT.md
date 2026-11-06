# Six-phase implementation audit

Reviewed 7 November 2026 by the main agent. All six phases are authorized and implemented in source. The latest instruction resumed runtime testing. **All phase exit gates are not yet complete:** funded Whitechain transactions, signed Arkiv writes and the human-narrated video remain pending. Local EVM, real Neon, actual CRE simulation and live sponsor reads are separate proof kinds.

| Phase | Implemented behavior | Verification and remaining boundary |
| --- | --- | --- |
| 1 — Foundation | Pinned Next/Neon workspace, isolated roles/migrations, wallet sessions/ownership, official screening, atomic audit/outbox and feasibility integrations | Actual database and signature checks, official OFAC import, live network/public reads and actual CRE HTTP route simulation. Funded Whitechain operations and signed Arkiv round trip pending. |
| 2 — Payments/store | Screened non-upgradeable router, exact approvals/typed authorization, canonical observer, signed/fenced delivery, separate durable merchant order API/store/entitlement | 26 local contract checks and complete local mock-token EVM + production HTTP + real isolated Neon payment/one fulfillment/download. Actual specified-USDT deployment/payment/explorer verification pending funding. |
| 3 — Merchant operations | Eleven dashboard sections, internal links/invoices, contacts with invoice/payment history, scoped keys, endpoint tests/rotation/replay, reports/CSV, risk, settings/sessions/audit | Real-Neon operation checks and real wallet/Neon browser CRUD plus interface fixtures. Contact history is tenant-bound, source-time gaps visible, orphaned invoices nonpayable, overview follow-up workspace-wide. Real local link/invoice payments, pause/deactivation and duplicate handling pass. Funded collection proof pending. |
| 4 — Refunds/public accounting | Reserved original-payer refunds/API/wallet panel, canonical refunds/reorgs, public projection/correction/lease/renewal, actual Arkiv SDK writer/query/verifier and independent accountant | Real-Neon refund/projection regressions and actual local5USDT refund/25–5–20 dashboard/verifier/CSV pass. Replacement-time backfill and writer leases checked. Actual gateway-stopped public browser query returns zero entities. Funded refund, signed entities/renewal and positive independent live accounting pending. |
| 5 — CRE recovery | Service-only candidate/current/request APIs, stable capped rounds, canonical evidence/order/current-state workflow, consensus-before-POST and fenced delivery attribution | Actual CRE CLI local recovery passes: signed notification fails, ordinary retry is exhausted, CRE schedules the existing event, one store fulfillment and one recovery audit, duplicate request schedules nothing. Eleven real-Neon recovery/auth/race/cap cases pass. Repeat with an actual funded Whitechain payment remains pending; no DON deployment claimed. |
| 6 — Release | Owned-process local supervisor, guarded PostgreSQL17 backup/restore, receipt repair, complete JS/Python adapters, CI dual-app checks, runbooks/demo/attribution | Complete local combined harness, actual JS/Python service/Neon execution, gateway/store isolated restore and six negative guards, supervisor start/stop/port conflict and independent accountant checks pass. The final114-test root suite,16 Chromium tests and7 Python checks pass; production builds/type/import checks pass. Exact scopes are in the release checklist. Human narration/video and live funding gates remain open; hosting is deferred. |

## Current evidence

- [Local payment and adapters](evidence/phase-2/local-payment-flow.json), [refund and collections](evidence/phase-4/local-refund-flow.json), [recovery/one fulfillment](evidence/phase-5/local-recovery-flow.json), [actual CLI hashes](evidence/phase-5/cre-recovery-simulation.json) and [sanitized CLI output](evidence/phase-5/cre-recovery-simulation.log).
- [Actual backup/isolated restore and six guards](evidence/phase-6/backup-restore.json), [service lifecycle](evidence/phase-6/local-lifecycle.json), [independent browser/public RPC](../apps/accountant/evidence/public-browser.json).
- [Release checklist](release-checklist.md) and [evidence index](evidence/index.md) retain exact commands/scopes. Historical counts overlap; do not sum them into a current-suite total. CLI success alone is insufficient: persisted intent, original notification, receiver fulfillment and CRE attribution are separately checked.

Earlier combined attempts exposed a harness response-envelope bug and intermittent Neon DNS/transport failures. The envelope was fixed and a clean full rerun passed. TLS stayed verified; no automatic retry of ambiguous commits or extension of monetary grants was introduced. Checked-out transaction socket errors now discard the broken client.

## Feature and failure review

- Every dashboard section/control has persistence or a real API action and loading/error/empty states. Contact history discloses its latest100 limit and opens payment details with nested focus restoration. Dated money and current unresolved work are distinct. Missing canonical timestamps are excluded from period sums and visibly disclosed.
- Money remains integer base units with exact chain/token/router/event/party/amount association, policy-bound short signatures and exact transfer deltas. Refund destinations remain the original payer. Redirects, transaction hashes, unsolicited transfers and test webhooks cannot mark paid.
- Tenant-first locks, atomic outbox, fenced jobs, refund reservations before executable payloads and receiver-side one logical fulfillment preserve current state. Source/policy/order/refund/version changes cannot revive stale acceptance. Later corrections record already-fulfilled exposure.
- Public records require trusted creator/owner and source verification before deduplication. Canonical timestamps and zero-money corrections preserve accounting. Replacement timestamps are backfilled before publication; deterministic IDs/query-first repair/global leases bound crash recovery. Live write/renewal proof is still funding-dependent.
- Recovery validates evidence identity before duplicate acknowledgment. Current refund/risk/order state wins. Auth/version/round/cooldown/cap/fenced-attribution tests pass. Manual replay cannot inherit CRE attribution. Endpoint validation now works in the actual CLI runtime without assuming the browser/Node URL constructor.
- Runtime credentials remain server-only/limited/pooled; direct admin connections retain verify-full TLS. Restore requires explicit isolated target/name/checksum, uses one transaction and never drops or switches runtime targets. Actual schema/data counts and refusal/rollback guards pass. Archives omit owners/grants; reapply limited runtime grants before any future cutover. Backups/keys remain private and ignored.

## Source map

| Capability | Principal paths |
| --- | --- |
| Merchant operations | packages/core/src/operations.ts; packages/db/src/operations*.ts; apps/gateway/app/api/operations; apps/gateway/app/dashboard |
| Internal checkout | apps/gateway/app/pay; app/invoice; app/collection.tsx; app/api/collection; DB collection services |
| Refunds | packages/db/src/refunds.ts; refund-observer.ts; refund-schema.ts; apps/gateway/app/api/refunds; app/refunds/refund-panel.tsx |
| Public accounting | packages/db/src/projection.ts; packages/worker/src/arkiv.ts; packages/arkiv; apps/accountant |
| Recovery | packages/db/src/recovery*.ts; apps/gateway/app/api/recovery; packages/cre/recovery.ts; scripts/cre-recovery.ts; scripts/recovery-demo.ts |
| Release/integration | scripts/local-stack.ts; scripts/database-backup.ts; scripts/public-receipts.ts; examples/javascript; examples/python; .github/workflows/ci.yml |

The [integration inventory](evidence/phase-6/integration-inventory.json) includes physical lines/bytes for helpers, durable order system, HTTP/UI and migrations. Python executes through the separate persistent Node/Neon store. Compact lines understate effort; integration time and merchant validation remain unmeasured.

## Official sponsor mapping

Rechecked7November2026. [Whitechain Operate](https://ethglobal.com/events/mumbai/prizes/whitechain) requires specified network/USDT, explorer-verified deployment/payment, README onchain rationale, separate customer/merchant views, steady source history, feedback and2–4minute video. Source/rationale/feedback exist; funded explorer evidence and narrated video remain pending. A browser helper is not the complete integration effort.

[Arkiv Build from scratch](https://ethglobal.com/events/mumbai/prizes/arkiv) requires actual SDK/API writes and a used query, README writer/query and ownership/expiry/schema/license/criterion/feedback files. Query/app/files and configured writer exist; signed entities are pending. [Chainlink CRE](https://ethglobal.com/events/mumbai/prizes/chainlink) accepts meaningful successful CLI simulation: actual local recovery now exists and joins chain data with a separate merchant API. Native Whitechain support and DON deployment are not claimed.

Human narration/submission/eligibility, merchant validation, public hosting and customer funds are not claimed. Complete the remaining live/human gates before calling every phase finished end to end.
