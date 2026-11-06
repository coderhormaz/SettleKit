# SettleKit: progress and session handoff

Updated: 6 November 2026 (IST). Read AGENTS.md, MEMORY.md, PROJECT_HANDOFF.md and IMPLEMENTATION_PLAN.md before acting.

## Current stage

**Phase 2's independent implementation/checks passed; Phases 3 and 4 are now authorized together.** Finish the current checkpoint then implement their detailed plans. Funded live gates stay open. There is no live deployed payment router, customer payment/refund, signed Arkiv entity write, live CRE DON deployment, public app deployment or merchant-validation claim.

Confirmed choices: Next.js + Neon PostgreSQL/Drizzle/pg; wallet signatures; wallet first, then business setup; local app/worker with public app hosting deferred; full scope beyond the event deadline if needed. The user requested efficient focused subagents and ongoing coherent tested GitHub pushes.

## Implemented and checked

- Pre-code architecture/UX/security review: PROCEED. The detailed [phase plan](docs/phases/phase-1.md) records dependencies and gates; PRODUCT.md records confirmed facts.
- Pinned workspace/lockfile. Actual CRE compiler failure on TypeScript 7 resolved with **5.9.3**; see [versions](docs/versions.md).
- Real isolated Neon development/test branches, migrations, limited runtime roles, TLS-verified pooled runtime/direct migration connections. Credentials remain in ignored local .env.
- Browser-bound single-use EIP-4361 login/proof, atomic nonce/session creation, hashed expiring sessions/logout, strict mutation origins, tenant-derived profile/proof/screening and atomic audit/outbox writes.
- Exact uint256 storage rejects overflow, negatives and fractional values without rounding. Jobs use transaction locks/fenced leases/capped retries. Actual database disconnect/reconnect and retry deduplication are tested.
- Official OFAC import validated/persisted: **19,555 records / 124 ETH identifier occurrences**, publisher URL/hash/timestamps and explicit narrow coverage. Malformed/stale/unavailable required data fail closed. Fixed a reviewed race so an older snapshot cannot clear a newer outage.
- Persistent local worker imports source state and processes screening jobs. It does not implement payment fulfillment or contract enforcement.
- Premium responsive wallet-first onboarding, real profile save/reload, settlement proof, source/status/refresh and logout. No fake balances, future navigation or payment controls.
- **37 tests passed**, including **8 actual Neon integration checks**; **3 Playwright tests passed**; typecheck/production build and official SDK import checks passed.
- Browser tests use actual server signatures/persistence with a Node-held throwaway test signer, never a private key in the browser. Session-expiry UI uses an explicit HTTP fixture; backend expiry is separately tested against PostgreSQL.
- Desktop 1440, tablet 768, mobile 390 and authenticated captures were inspected. Impeccable detector returned []; a fresh finish reviewer returned **ship at visual scope**, no material fixes. This verdict does not prove API/security/sponsor execution.
- Whitechain network/token/proxy reads and zero-value approve/transfer eth_call passed; generated roles remain unfunded. Hardhat/viem/OZ/solc/prague smoke compilation passed, no router/deployment.
- Arkiv SDK owner-filtered query and independent public-RPC Chromium query passed without gateway API/private browser credentials. Zero writer entities; no signed write.
- **Actual CRE CLI simulation passed**, reading fixed Whitechain RPC/token metadata plus a separate local diagnostic merchant API. Verified tools, user interactive login, production simulation limits, no broadcast. Sepolia is documented as CLI bootstrap only; native Whitechain support, payment recovery and prize eligibility are not established.

See the [evidence index](docs/evidence/index.md) for exact commands/artifacts and the distinction between local fixtures, live reads, simulation and missing signed transactions.

## Deferred gates

The user explicitly chose **Continue independent work; I’ll fund it later** for both funding questions. Do not repeatedly request funding or bypass these gates.

1. **Arkiv entity create/read:** test writer 0xAB5C7220E7d98D57181346d00D6E7957f42Af486 needs tGLM through the official Hub. If required, keep ARKIV_ACCESS_KEY in ignored .env. Then verify an actual entity key and query from the SDK script.
2. **Whitechain funded approval/transfer:** payer 0x2D3C8DdC302F86C6a88E7673E0094C6730dF9A5A needs WBT and exact sponsor USDT; merchant 0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192 needs WBT. Other test roles are in sanitized wallet evidence. Zero-value eth_call is not funded transaction proof.

Private test keys stay in ignored data/phase-1-wallets.json. No customer funds, substitute network/token or production deployment is authorized.

## Phase status

| Phase | Status |
| --- | --- |
| 1 — Foundation/feasibility | Independent implementation/checks passed; signed write/transfer funding gates open |
| 2 — Router/payment/store | Authorized; local implementation/checks in progress; funded live evidence pending |
| 3 — Merchant dashboard | Authorized; detailed plan prepared, implementation next |
| 4 — Refunds/accountant | Authorized; detailed plan prepared, funded live gates deferred |
| 5 — CRE recovery | Not started; the route proof is not recovery |
| 6 — Integrated release | Not started |

## Git and next action

Authorized remote: https://github.com/coderhormaz/SettleKit.git; main, normal pushes only. Preserve existing history. Phase 1 checkpoint `4ee6743a0bd8e4904619711a48fe7256473a6409` is pushed, remotely verified and its GitHub Actions completed successfully. Phase 2 checkpoint is being prepared, not yet claimed pushed. Obtain the actual tip from git log/ls-remote; staged files do not prove publication.

Finish Phase 2 review/checkpoint, verify remote hash, then implement Phases 3 and 4 from their detailed plans. Preserve funded gates as pending and wait before Phase 5. Resume existing work instead of reinstalling or duplicating research.

## Phase 2 implementation and verification

- [Detailed plan](docs/phases/phase-2.md) reviewed PROCEED before coding; [runbook](docs/phases/phase-2-runbook.md) records local operation and funded gates.
- Non-upgradeable noncustodial router includes payment and full/partial refund primitives, EIP-712 exact parameter/evidence binding, replay guards, original merchant/payer refunds and caps, exact transfer deltas, reentrancy protection and separate policy-owner/signer roles. Onchain policy epoch/expiry/denial/pause controls fail closed.
- Hashed server keys/encrypted integration secrets, authoritative authenticated order reads, tenant-idempotent immutable checkout, approved return origin, one-use payer proof and short source/policy-bound authorization. Configured runtime codehash/token and policy are read at a consistent canonical anchor.
- Versioned PostgreSQL migrations, bounded durable cursor/overlap observer, exact canonical receipt binding and atomic payment/version/delivery/outbox. Reorg corrections and actual onchain refund quantities hold further fulfillment.
- Raw-body HMAC notifications, DNS-pinned approved endpoints, absolute transport deadlines, retry budgets/dead state and live fenced leases. Current source/policy/version/refund eligibility grants are rechecked and capped at final issuance.
- Hosted checkout separates wallet signature/approval/payment and handles expiry/pending/reload/retry/error states. Return/hash never means paid. Real basic merchant payments/detail/delivery views; full dashboard is Phase 3.
- Separate Fieldwork store uses its own limited-role Neon databases, server-owned 25 USDT catalog, durable order reads, transactional receipt/payment dedupe, one fulfillment, cancellation/correction exposure and actual workbook entitlement. [Integration guide](examples/store/README.md).
- Final verification: 64 unit/database tests passed in one root suite, 26 local EVM contract tests passed, contracts TypeScript and production build passed. Eight database checks use actual Neon with explicit mock RPC for canonical/policy/refund/final-grant races; none are live Whitechain evidence.
- Store protocol/database checks (7 HMAC/transport + 6 actual Neon) passed and are included in the root suite. Matching development services passed 13 actual local HTTP checks plus a Chromium store→checkout→pending return at all three sizes; no payment executed. Sanitized records are under `examples/store/evidence/`.
- All 8 browser checks passed after fixing mobile Refresh-button overflow; captures include actual onboarding plus labeled payment UI fixtures. Detector: zero nonadvisory findings; 156 inherited/intentional color/type/radius advisories (do not claim []). Fresh independent finish reviewer returned **ship** for all 14 checkout/payments/actual-store captures, no material fixes. Existing DESIGN.md/sidecar preserved as an ordinary extension.
- Independent security review's pre-send lease race and grant extending source expiry were fixed with regressions; reviewer returned PROCEED. Complete local EVM/mock-token + actual HTTP/Neon payment harness passed: payer75/merchant25/router0 USDT, observer restarts/duplicate logs, lost-ack delivery retry, one receipt/fulfillment and actual download. Fixtures/processes cleaned; [evidence](docs/evidence/phase-2/local-payment-flow.json) explicitly says not live Whitechain.
- Deployer and policy-admin test roles also require WBT for live deployment/synchronization. No broadcast/source verification/live payment is claimed. The user-deferred funding gates above remain open.
