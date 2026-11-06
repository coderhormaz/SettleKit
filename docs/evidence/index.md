# Evidence index

Updated 6 November 2026 (IST). Phase 1 independent checks and Phase 2 local implementation passed; funded testnet gates stay deferred. Phases 3 and 4 are authorized. This index distinguishes local checks/fixtures, live reads, signed writes and real CRE simulation.

| Requirement / gate | Implementation and reproducible command | Evidence / actual outcome |
| --- | --- | --- |
| Compatible workspace | Root lockfile, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` | Installed pins/compatibility failures in [versions](../versions.md); typecheck and production build passed. |
| Exact private monetary persistence and atomic state/jobs | `packages/db`; `pnpm test` with isolated test configuration | 37 tests passed, including 8 real Neon checks. Round trips, fractional/overflow rejection, rollback/outbox, SIWE races, isolation, source-health ordering, job fences and disconnect/idempotent retry. [Neon metadata](phase-1/neon-foundation.json). |
| Required screening baseline | `packages/screening`, worker; `pnpm screening:import` | Actual official import persisted 19,555 records / 124 ETH identifier occurrences; [provenance](phase-1/screening-source.json). Includes synthetic edge-case tests, distinct from live source read. |
| Usable identity/setup | `apps/gateway`; `pnpm test:browser` | 3 browser tests passed using actual server signatures/persistence and an injected test wallet; session-expiry UI uses an HTTP fixture. [Desktop](phase-1/screenshots/desktop.png), [tablet](phase-1/screenshots/tablet.png), [mobile](phase-1/screenshots/mobile.png), [saved desktop](phase-1/screenshots/authenticated-desktop.png), [saved mobile](phase-1/screenshots/authenticated-mobile.png); fresh visual review: ship. No customer adoption claim. |
| Whitechain exact network/token | `packages/feasibility/src/whitechain.ts` | [Live read-only evidence](phase-1/whitechain-network.json). Zero-value `eth_call` is simulation, not a transaction. [Test roles/balances](phase-1/whitechain-test-wallets.json) remain unfunded. |
| Whitechain router/payment | `packages/contracts`, checkout/observer/store; Phase 2 | Implemented and locally verified. No live deployment/payment/source-verification claim; funding deferred. |
| Arkiv real SDK query and independent browser | `packages/feasibility/src/arkiv.ts`, `arkiv-browser.ts` | [SDK query](phase-1/arkiv-network.json), [independent public browser query](phase-1/arkiv-browser.json); empty writer results, no private browser credential or gateway API. |
| Arkiv signed entity round trip | Same reproducible script after funding | **Pending user-deferred writer funding.** No entity key or signed-write claim. |
| CRE Whitechain HTTP + separate API | `packages/cre`; commands in its README | [Actual successful CLI simulation](phase-1/cre-simulation.json), [run log](phase-1/cre-simulation.log), [native/bootstrap limitation](phase-1/cre-native-network-check.json). Proves route capability, not payment recovery/DON deployment/eligibility. |
| Contract toolchain | `packages/contracts`, compile/smoke scripts | [Actual Hardhat/solc/prague compilation](phase-1/contract-toolchain.json). Smoke only, no payment router. |

Selected sponsor requirements remain in the handoff and phase plan. Later phases add actual router/payment/refund/Arkiv accounting/recovery evidence rather than relabeling these feasibility probes.

## Phase 2 implementation checks

| Scope | Actual evidence and boundary |
| --- | --- |
| Router | 26 local simulated-EVM security cases in `packages/contracts/test/router.test.ts`: domains/fields/replay/denials/expiry/exact transfers/refund caps/reentrancy. No live deployment. |
| Private state and receiver | 64 root unit/database checks, including actual isolated Neon concurrency, auth/order/outbox/lease/source/receipt/refund/grant cases and explicit HTTP/RPC fixtures. Full suite passed after security review fixes. |
| Complete local payment | [Local EVM + actual production HTTP/Neon](phase-2/local-payment-flow.json): actual mock-token approve/pay, observer restarts, duplicate logs, lost-ack webhook retry, one fulfillment and download; payer75/merchant25/router0 USDT. Explicitly not Whitechain/sponsor-token proof. Reproduce `node --env-file=.env --import tsx packages/contracts/scripts/local-payment-flow.ts`. |
| Matching separate services | [13 actual local HTTP checks](../../examples/store/evidence/local-http.json) and [actual Chromium pending flow](../../examples/store/evidence/browser-flow.json); server catalog25USDT, keys/origin/body/HMAC/idempotency rejection, no payment/fulfillment because deployment absent. |
| Responsive UI | 8 Playwright checks passed; actual wallet login/profile persistence and explicit HTTP/RPC wallet/payment-state fixtures. [Checkout desktop](phase-2/screenshots/checkout-desktop.png), [mobile](phase-2/screenshots/checkout-mobile.png), [payments desktop](phase-2/screenshots/payments-desktop.png), [mobile](phase-2/screenshots/payments-mobile.png), [actual store](phase-2/screenshots/store-actual-pending-desktop.png). Overflow fixed, keyboard/mobile navigation checked. |
| Remaining live exit gates | Actual source-verified Whitechain router, 25 sponsor-USDT payment/one external fulfillment and explorer link; later original-payer refund and signed Arkiv receipts remain funded gates. No source/transaction/entity claim is inferred from a local fixture. |
