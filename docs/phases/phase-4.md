# Phase 4 — refunds and independent accounting

Authorized 6 November 2026 (IST); all six phases were subsequently authorized. Source is integrated, including refund service/UI/observer and public projection/accountant. Eight dedicated real-Neon refund cases with explicit RPC fixtures and earlier Arkiv/accountant checks passed. Latest instruction: main agent only; further tests deferred. New correction/retraction changes need regression. Funded live payment/refund/Arkiv-write gates remain open. See the [implementation audit](../IMPLEMENTATION_AUDIT.md).

## Architecture and current docs

Keep private refund coordination in Neon; Whitechain events are monetary truth; Arkiv is a public query projection, never our private coordinator. Alternatives reviewed: direct UI token transfers lose invoice/refund caps; an Arkiv-only history cannot establish source-chain validity or completeness; a gateway-only accountant is not independent. Choose durable refund intents + existing router, outbox SDK projection, and a separately served public-RPC accountant.

Rechecked the [selected Arkiv rules](https://ethglobal.com/events/mumbai/prizes/arkiv), [expiration](https://docs.arkiv.network/writing/expiration/) and [filtering](https://docs.arkiv.network/querying/filter/) on 6 November 2026. Follow installed SDK 1.0.1 types, current Rabdi7794095 and writer filtering; old docs presets do not override live chain ID. Reuse MIT-licensed project-generated minimal settlement facts, with no PII/order numbers/contacts/risk data/secrets published.

## File plan and tasks

FILES TO CREATE: `packages/db/src/refunds.ts` (intent/authorization/revalidation), `packages/arkiv/` (browser-safe public schema/queries and separate server writer), `apps/accountant/` (independent public client), refund UI/dialog/details, refund/Arkiv/coverage meaningful tests, schema/retention and sponsor criterion docs/evidence.

FILES TO MODIFY: private schema/migrations, observer/worker job dispatch, source-chain ABI verification, webhook receiver corrections, dashboard reports/details/navigation, REST routes/env/version/docs. Never upgrade or replace the tested router to bypass refund rules.

- [ ] 1. Review prerequisites/current sponsor APIs, current-state race model and this detailed plan.
- [ ] 2. Persist idempotent positive integer refund intents under payment lock; enforce remaining amount and simultaneous reservations. Advance eligibility version and hold fulfillment before returning any executable payload.
- [ ] 3. Fresh original merchant/payer screening and policy checks; generate operation-specific signed refund authorization bound to original chain/router/token/payer/merchant/invoice/refund ID/evidence/epoch/deadline. Merchant wallet must execute; service/CRE cannot spend on its behalf.
- [ ] 4. Refund UX: amount/remaining, inline validation, current reasons, original wallet/network/balance/needed allowance, explicit confirmation, separate approval/execute, pending/reverted/expired/review/history. Idempotent retry and canonical state survive reload.
- [ ] 5. Observe and verify refund receipts/canonical blocks; only chain events change totals. On failed/cancelled/expired intent, release hold only after authoritative chain totals and all outstanding authorizations are expired/invalidated. Version/audit/corrective events preserve already-fulfilled exposure.
- [ ] 6. Add durable Arkiv sync jobs for canonical payment/refund/correction records with deterministic event key, trusted writer/schema/ownership, indexed search fields, expiry/renewal and retry. Recover successful-write→mapping crash via deterministic-key prediction or exact owner/event query before retry; never blindly duplicate.
- [ ] 7. Independent accountant reads public Arkiv via actual SDK/RPC, filters merchant/kind/date/block, paginates, deduplicates and verifies source receipt/event/code/token/amount/parties/canonical block. Show rejected records and source-RPC errors explicitly.
- [ ] 8. Scan bounded Whitechain router range from deployment to stated head, reconcile payment/refund events against available verified entities, show progress/missing/expired coverage. Gateway-stopped mode must still query public history. Empty Arkiv query is not complete history.
- [ ] 9. Exact 25/5/20 gross/refund/net calculations and formula-safe CSV across dashboard/accountant. Test forged writer/mismatched/replayed/expired/missing/reorg data and pending-refund versus delivery races.
- [ ] 10. Verify responsive/keyboard/wallet/error flows, local full refund→accounting harness, actual SDK read/write when funded, genuine explorer/entity references, evidence/docs and coherent GitHub pushes.

Critical path: refund hold schema/atomic eligibility→authorization→UI→canonical observer; public schema/writer dedupe→queries/verification→coverage/accountant. The accountant must not import private database, gateway history API or writer key. Isolated tests precede dev migration; preserve funded live gates.

Pre-code independent review: PROCEED. Keep each intent's refundId/amount immutable across retries and serialize reservations; read verified monetary chain state separately from fulfillment eligibility after applying the deliberate hold. Persist canonical source timestamps. Public correction records never contribute sums. Verify before deduplicating so an orphaned earlier record cannot suppress a later canonical version; reconcile explicit source-event block ranges.

## Data, privacy and races

Refund intent has immutable payment/original association, idempotency key/body hash, exact amount, state/version, bounded reservation, short authorization terms and optional untrusted submitted hash. Concurrent partial/full requests serialize under the original payment. Intent states remain distinct from canonical refunds and delivery. Cancellation of an outstanding signed authorization cannot be assumed immediate; preserve hold until chain state and its execution window are revalidated.

Observed refund keys are tx/log/block associated and deduplicated. Reorg retracts current canonical totals while retaining audit/intent exposure; it does not create an automatic new refund or fulfillment. An old accepted webhook cannot overcome current hold/refund/cancel/review state. Partial refunds default to review for new fulfillment. Merchant wallet changes leave historical original merchant refunds bound to the old proven wallet.

Public receipts contain schema/version, opaque stable event reference, kind, source chain/router/token, tx/log/block evidence, payer/merchant, exact amount and source timestamp. No predictable private order hash is presented as anonymization. Writer ownership is part of trust; query data remains mutable/removable/expiring. Use explicit retention (initial 90 days with scheduled renewal threshold); disclose no perpetual availability/deletion guarantee. Completeness comes only from the stated bounded chain reconciliation, never from owner-filtered records alone.

## UX and acceptance

Merchant opens payment→refund→valid amount/current checks→original wallet confirmation→approval if needed→refund transaction→canonical pending/confirmed or actionable revert/review. Back/close preserves pending intent. Accountant enters configured merchant/range→query progress→available verified totals→coverage gaps/details/explorer/entity/export. Unsupported/unavailable data is visible; there are no fabricated transactions or success states.

All surfaces cover loading, no records, partial coverage, permission, wallet rejection, source outage, validation, pending, expired authorization, failed retry and success. Inspect desktop/tablet/mobile, long amounts/addresses, keyboard focus and reduced motion using inherited premium tokens. Exit requires real original-payer refund and signed Rabdi entity proofs for full phase completion; local EVM/SDK fixtures and actual public reads are recorded separately.
