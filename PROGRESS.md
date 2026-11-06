# SettleKit: progress and session handoff

Updated: 6 November 2026 (IST). Read AGENTS.md, MEMORY.md, PROJECT_HANDOFF.md and IMPLEMENTATION_PLAN.md before acting.

## Current stage

**Phase 1 is implemented for independently available gates; the phase remains open for user-deferred test funding.** Phases 2–6 have not started. There is no deployed payment router, customer payment/refund, signed Arkiv entity write, live CRE DON deployment, public app deployment or merchant-validation claim.

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
| 2 — Router/payment/store | Not started; not authorized |
| 3 — Merchant dashboard | Not started |
| 4 — Refunds/accountant | Not started |
| 5 — CRE recovery | Not started; the route proof is not recovery |
| 6 — Integrated release | Not started |

## Git and next action

Authorized remote: https://github.com/coderhormaz/SettleKit.git; main, normal pushes only. Preserve original 0aa6e69, documentation checkpoints 1bec3f7/8049058/7c33d7c/3294c83 and existing workspace checkpoint e53c951. Obtain the current checkpoint hash from git log and verify the push with git ls-remote; staged files do not prove publication. Record any exact pending push failure here.

Finish current evidence/documentation/checkpoint verification, report Phase 1 open for the two deferred funded proofs, and wait for funding to finish them. Resume existing work instead of reinstalling/researching again. Do not start Phase 2 without the user's instruction or call Phase 1 fully complete before its signed live gates pass.
