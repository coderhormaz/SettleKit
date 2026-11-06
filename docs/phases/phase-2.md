# Phase 2 — screened payment and store fulfillment

Authorized by the user on 6 November 2026 (IST); all six phases were subsequently authorized. Phase 2 local implementation/checkpoint is pushed; funded Whitechain deployment/payment and Arkiv write gates remain deferred. Latest steering: main agent only, finish code and defer further tests. Current source/check boundaries are in PROGRESS.md.

## Outcome and boundaries

A merchant creates an idempotent priced checkout through a server key; a buyer connects, signs ownership proof, passes fresh required screening, approves only the required sponsor USDT and pays a noncustodial router. A canonical observer accepts a precisely matched event and sends a signed, retryable notification. A separate durable store validates current eligibility and fulfills its order once. The router includes screened full/partial refund primitives now; refund application UX and Arkiv accounting remain Phase 4.

Use Whitechain 1874 and the exact sponsor token. Local Hardhat uses an explicitly labeled mock token solely for tests. No alternate live settlement, customer funds, public hosting, custody or invented payment proof.

## Architecture decision and exploration

Existing Next catch-all routes call private `packages/db` services; `packages/core` keeps browser-safe types separate from Node crypto. The worker already has fenced PostgreSQL outbox leases and current source imports. Extend these layers instead of creating another general backend. Alternatives: a separate API framework duplicates auth/transactions; a browser-only transfer cannot enforce screening/order association. Chosen: typed EIP-712 contract + private transactional services + persistent polling worker + small standalone Node store and shared receiver.

The operator signing/policy keys are separate from merchant sessions. Check configured chain/token/router bytecode, signer, pause, epoch and policy validity before issuing short authorizations; required source outage blocks signing. Router policy has an onchain validity deadline, so a stopped synchronizer fails closed. New hard denials advance the epoch; protected operator synchronization is required before signing. No claim of instant discovery of new lists: source refresh interval and last confirmed epoch are explicit. Payer ownership is proven by a session-bound challenge, not a supplied address alone.

## Files and ordered tasks

FILES TO CREATE

- `packages/contracts/contracts/SettleKitRouter.sol`, test token/test suite, deploy/verification scripts — immutable token, EIP-712 payment/refund, policy role/epoch/expiry/denial controls and events.
- `packages/core/src/payment.ts`, `packages/core/src/webhook.ts` — shared typed authorization/event inputs and bounded raw-body HMAC adapter.
- `packages/db/src/payments.ts`, `packages/db/src/observer.ts`, migrations — API credentials, checkout/challenges/authorizations, canonical payment events, cursor and deliveries; exact integers, tenant/idempotency constraints.
- `packages/worker/src/payments.ts` — bounded observer and eligible webhook delivery, policy checks and operator tools.
- `apps/gateway/app/checkout/[reference]/page.tsx`, checkout component and basic merchant payment view — real state, no unfinished navigation.
- `examples/store/` — independent durable orders, fixed server catalog price 25 USDT, checkout redirect, authenticated order reads, verified/deduplicated webhook and demo UI.
- `docs/design/checkout.md`, integration/runbook/evidence and meaningful unit/Postgres/contract/browser tests.

FILES TO MODIFY

- Core/db exports/schema, Next route handler, worker dispatch, workspace scripts/manifests/env example, CI, onboarding navigation and project status/evidence. Existing identity/profile behavior remains compatible.

TASK ORDER

- [x] 1. Review scope, dependencies, threat/UX model and current sponsor APIs; close Phase 1 Git checkpoint (`4ee6743`, remote verified, CI passed).
- [x] 2. Implement/test router payment and refund primitives, domain/replay/denial/transfer adversarial cases (26 EVM tests).
- [x] 3. Add versioned migrations, service credentials, idempotent session/ownership/screened authorization services and exact event verifier.
- [x] 4. Implement canonical bounded observer, atomic acceptance/correction/outbox, retryable signed delivery and current-state eligibility.
- [x] 5. Build standalone durable store/receiver/order-read adapter and complete hosted checkout/basic merchant payment UI.
- [x] 6. Verify local vertical flows, races/restarts/reorgs, tenant/security limits and responsive rendering. Final: 64 unit/database, 26 EVM, 8 browser checks; actual local EVM/HTTP/Neon complete flow; security PROCEED and fresh visual ship. Live proof is separate.
- [ ] 7. When funded, deploy/source-verify router and collect actual 25 USDT payment/one-fulfillment evidence, bypass rejection and explorer link. Never substitute local fixtures.
- [ ] 8. Update docs/memory/evidence, verify normal GitHub pushes and report remaining gates.

CRITICAL PATH: router ABI/types precede authorization, observer and checkout. Schema/migrations precede services/store. Tests use the existing isolated Neon branch first; separate store database/role prevents gateway writes into orders. Live funding blocks task 7, not local tests and implementation.

## Data, security and races

- Amount is an integer base-unit string, positive and <= uint256. Store catalog is authoritative; checkout creation is authenticated/scoped with mandatory idempotency key and body hash. Duplicate request with changed body fails. Merchant/settlement association is snapshotted.
- Unguessable public reference exposes only checkout essentials. Return URL must use the merchant's stored approved origin; never fetch buyer input. Configured webhook/order endpoints are operator-approved, immutable per credential in this phase; reject credentials/fragment/redirects/private targets except exact explicit loopback development endpoints. Full merchant configuration/rotation UI is Phase 3.
- Ownership nonce binds reference, payer, browser proof, chain and short expiry, is one-use; auth commits bind evidence/epoch/exact invoice/recipient/amount/expiry. Auth expiry never exceeds source or onchain policy validity. No authorization issued while state is paid/cancelled/review/expired.
- Verify success receipt, chain, router, token, invoice, payer, recipient, amount, authorization evidence and canonical block. Unknown/direct transfers do not count. Deduplicate tx/log; durable cursor with bounded ranges/overlap and recheck accepted block hashes. Chosen initial acceptance: 2 included blocks, explicitly labeled soft confirmation, no finality claim.
- Payment, risk, canonical status, refund hold, order and delivery are distinct. Eligibility advances monotonic version; cancellation/refund/reorg/review blocks new fulfillment. Correction events do not erase paid evidence. Orphaned delivery after fulfillment records review exposure.
- Stable event ID and raw body HMAC include timestamp/version. Delivery rechecks screening/current chain/order state before sending. Receiver checks signature/time then authenticated current eligibility before a transaction that locks/deduplicates payment/order and increments fulfillment once. At-least-once notifications; receiver idempotency gives one logical fulfillment. Cross-system races cannot be made atomic; authorize a short grant, revalidate before receiver commit and record conflicts/corrections without claiming impossible rollback of delivered goods.
- Secrets only in ignored env/encrypted DB; no payer/merchant private keys in frontend. Bounded bodies, requests, RPC ranges, timeouts, attempts and leases. Logs/errors contain safe codes only. Merchant sessions cannot administer policy/signer.

## Journeys and states

Merchant: existing wallet setup → payments view → view precise state/detail/delivery/risk. Integration uses server configuration and a documented small adapter. Empty state explains no payments; failed load retries; expired session returns to sign-in. No fake statistics, refunds/Arkiv/CRE buttons.

Buyer: store product (25 USDT server price) → hosted checkout → connect wallet → switch Whitechain → sign wallet proof → required checks → exact approval if needed → pay → confirming → accepted/delivery status → approved return. Reject/retry wallet prompt, missing wallet, wrong network, insufficient USDT/WBT, blocked/stale source, expired/reused checkout, duplicate submit, RPC/dependency error, browser reload and reorg/review have clear states. Return never marks paid. Mint/graphite system inherited, order amount/payee/chain lead, infrastructure details remain outside merchant setup.

Store: create order → checkout → status fetched from own API → eligible signed event → one durable fulfillment. Cancelled/mismatched/refunded/review/old-version events do not fulfill. Missing notification leaves pending and can retry within budget.

All affected surfaces: loading, empty, validation/error with retry, unavailable, permission denied, pending and success; keyboard focus, readable addresses, no horizontal overflow at 390×844/768×1024/1440×900, reduced motion. Browser back/reload preserves authoritative server state.

## Verification and evidence

Rechecked [Whitechain track](https://ethglobal.com/events/mumbai/prizes/whitechain), [official Hardhat deployment](https://docs.whitechain.io/build/deploy/deploy-with-hardhat) and [OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography) on 6 November 2026. Keep compiler 0.8.38/prague and compatible installed pins. Sponsor qualification still needs source-verified Whitechain deployment and real specified-token payment; no local test establishes it. Arkiv/CRE selected scope stays unchanged.

Checks: contract signature/domain/field/replay/epoch/expiry/denial/transfer/refund bounds and reentrancy; exact-value/tenant/idempotency/nonce races on real isolated Neon; canonical evidence mismatch/reorg/duplicate/restart; raw body signature/time/body tamper; cancelled/refund/review state and receiver dedupe; current source outage blocks auth/fulfillment. Build/typecheck/unit/integration/browser with authenticated flows and desktop/tablet/mobile captures; fresh visual/security review, staged secret scan and remote hash verification. Store integration line count is measured honestly including order reads/configuration.

Exit: all local behavior reviewed and passing; actual source verification/deployment/payment/one-fulfillment proofs required for full Phase 2 completion. Open funding gates stay explicitly pending, with runnable commands and no fabricated hashes.
