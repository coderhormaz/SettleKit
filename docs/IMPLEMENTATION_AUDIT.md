# Six-phase implementation audit

Reviewed 7 November 2026 by the main agent. All six phases are authorized. The latest instruction stops subagents and defers further test runs. This is a source/compilation audit, **not a declaration that all exit gates passed**. Deferred testing, funded evidence, human narration and future hosting remain separate.

| Phase | Implemented source | Existing evidence | Open gate |
| --- | --- | --- | --- |
| 1 — Foundation | Pinned Next/Neon workspace, isolated roles/databases, wallet sessions/ownership, official-source screening, atomic audit/outbox and feasibility integrations | 37 historical root checks, 3 browser cases, actual OFAC import, live network/public-query reads, actual CRE route simulation | Funded Whitechain deployment/transactions and signed Arkiv write |
| 2 — Payments/store | Non-upgradeable screened router, exact approvals/typed authorization, canonical observer, versioned HMAC delivery, separate durable merchant store/order API/entitlement | 26 local contract cases,64 earlier root checks, 8 browser cases, actual local EVM + production HTTP + Neon payment/one fulfillment | Actual source-verified Whitechain router and specified-USDT payment; later changes need regression |
| 3 — Merchant operations | All 11 dashboard sections; link/invoice internal collections, private contacts, scoped keys, endpoint tests/rotation/replay, period reports/CSV, risk notes/resolution, pause/profile/sessions/audit | 89 expanded root checks including 9 actual Neon operation and 15 synthetic Arkiv cases;13 browser cases; separate real dashboard CRUD/HMAC browser pass | Later UI/source changes require the deferred regression/visual pass; funded collection proof |
| 4 — Refunds/public accounting | Reserved original-payer refunds/API/wallet panel, canonical refund/reorg observer, public projection/corrections/leases/renewal, real Arkiv SDK writer/query/verifier, independent accountant/filter/coverage/CSV | 8 dedicated real-Neon refund checks with explicit RPC fixtures;15 earlier Arkiv cases; real public empty SDK/browser queries with gateway stopped | Funded actual refund/entities/25–5–20 accounting; newest correction/projection paths and extended local harness not run |
| 5 — CRE recovery | Service-only candidate/current/request API, stable bounded recovery rounds, real CRE evidence/order/current-state workflow, consensus-before-POST, actual CLI wrapper, local failure injector and persisted delivery attribution | Actual recovery WASM compilation; earlier Phase 1 route simulation is separate | Actual failure→CRE simulation→notification→one fulfillment proof and unsafe-state/concurrency matrix |
| 6 — Release tooling | Four-service local supervisor, isolated backup/restore tools, failed receipt repair, complete JS/Python adapters, CI dual-app build, runbooks, demo/release checklist and attribution | TypeScript including JS examples, both Next production builds and CRE WASM compile pass; migration 0008 applied on isolated test then development branches | New tooling/Python runtime verification, clean setup/restore, final integrated/visual regression and human-narrated video |

Historical counts overlap and refer to different snapshots; do not sum them or describe the current tip as fully tested. Latest checks are static compilation/migrations only. CI runs its existing secret-free checks automatically on authorized pushes; this does not establish live sponsor proof.

## Feature inventory and invariants

- **Dashboard:** `/dashboard` routes to overview. Payments include full details and refund lifecycle. Links/invoices create real typed internal checkout orders; they do not require a fake external adapter. Profile/contact/invoice private fields stay off public routes and Arkiv. Every section has server persistence and explicit loading/error/empty states; no placeholder navigation was found in source review.
- **Money:** integer base units, exact chain/token/router/event/party/amount association, short policy-bound signatures, exact transfer deltas, original-merchant refund transactions and original-payer destinations. Direct settlement is not a custodial balance. A hash/redirect cannot mark paid.
- **State/races:** tenant-first row locks, atomic transition/outbox, held refund reservations before executable payloads, current grant checks around store locking, receiver-side unique logical fulfillment and fenced jobs. Cancellation/source/policy/refund/version changes cannot revive old acceptance. Cross-system conflicts after fulfillment remain review exposure.
- **Public records:** minimal source facts, trusted owner+creator, verify before logical deduplication, canonical source timestamps and zero-money corrections. Publication identity includes block hash and timestamp; correction backfill waits for the real replacement timestamp. No PII, credentials, private order/customer/risk notes are published.
- **CRE attribution:** manual replay strips recovery actor/key and supersedes other queued retry jobs. Only successful completion of the currently fenced CRE-keyed job records `recovery.delivered` and the dashboard timestamp. An authenticated request still needs actual CLI proof before it can be described as an executed CRE run.
- **Operations:** failed Arkiv repair is explicit and bounded; active jobs are skipped. Supervisor controls owned processes only. Backup/restore refuses default/test app targets and never drops/creates databases. Neither command was runtime-verified in this final code pass.

## Source map

| Capability | Principal paths |
| --- | --- |
| Private operations/data/API | `packages/core/src/operations.ts`, `packages/db/src/operations*.ts`, `apps/gateway/app/api/operations`, `apps/gateway/app/dashboard` |
| No-code checkout | `apps/gateway/app/pay`, `app/invoice`, `app/collection.tsx`, `app/api/collection`, DB collection services |
| Refunds | `packages/db/src/refunds.ts`, `refund-observer.ts`, `refund-schema.ts`, `apps/gateway/app/api/refunds`, `app/refunds/refund-panel.tsx` |
| Public projection/accountant | `packages/db/src/projection.ts`, `packages/worker/src/arkiv.ts`, `packages/arkiv`, `apps/accountant` |
| Recovery | `packages/db/src/recovery*.ts`, `apps/gateway/app/api/recovery`, `packages/cre/recovery.ts`, `scripts/cre-recovery.ts`, `scripts/recovery-demo.ts` |
| Release/integration | `scripts/local-stack.ts`, `scripts/database-backup.ts`, `scripts/public-receipts.ts`, `examples/javascript`, `examples/python`, `.github/workflows/ci.yml` |

The [static integration inventory](evidence/phase-6/integration-inventory.json) reports physical lines **and bytes** for helpers, order system, HTTP/UI and migrations. Python delegates its transaction callback to the existing independent Neon store; it is not a replacement database or an in-memory fulfillment demo. Full setup/order-read/error/transport/callback work counts toward integration effort. Hands-on integration time and real merchant validation are unmeasured.

## Sponsor evidence mapping

| Official requirement | Source and current boundary |
| --- | --- |
| [Whitechain Operate](https://ethglobal.com/events/mumbai/prizes/whitechain): meaningful external-business integration, specified asset/network, post-payment operation, source/feedback | Router + separate store + dashboard/refunds/export; local monetary proof exists. Actual specified-token deployment/payment/refund/source verification remains funding-dependent. Feedback is [recorded](../WHITECHAIN_FEEDBACK.md); no sponsor message sent. |
| [Arkiv build from scratch](https://ethglobal.com/events/mumbai/prizes/arkiv): actual SDK writes and visible queries, ownership/expiry/schema/license/criteria | Official SDK writer and worker plus independently served verified query/coverage app; [criterion files](../arkiv/) exist. Actual queries return zero writer records; signed write/entity/renewal proof remains pending. |
| [CRE workflow](https://ethglobal.com/events/mumbai/prizes/chainlink): meaningful chain/external API workflow and actual execution/simulation | Real recovery SDK source/API/CLI wrapper compiles; earlier HTTP route simulation passed. Actual recovery run still pending. Sepolia only bootstraps CLI; native Whitechain and DON deployment are not claimed. |
| Event/source/AI/demo requirements | Genuine history, license, third-party/AI notes, script and evidence index exist. Human narration/final video/submission/eligibility are not claimed. |

The exact later verification queue is [release-checklist.md](release-checklist.md). Known open items are proof/verification/human inputs; they are not reasons to substitute another chain/token/sponsor or silently weaken screening. Any gap found by the later pass must be fixed before final release completion.
