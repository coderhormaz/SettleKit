# Evidence index

Updated 7 November 2026 (IST). All six phases are authorized and source is present. Further tests are user-deferred; main agent only. This index separates historical checks, current static builds, live reads, signed writes and actual CRE simulation. See the [implementation audit](../IMPLEMENTATION_AUDIT.md).

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

## Phase 3–6 implementation and evidence boundary

| Scope | Actual result / limitation |
| --- | --- |
| Dashboard | 89 expanded root cases included9 real-Neon operation cases;13 browser cases included5 dashboard HTTP fixtures. Separate real wallet-signature/Neon CRUD/HMAC browser pass: [checks](phase-3/dashboard-checks.json), [desktop](phase-3/screenshots/real-overview-desktop.png), [tablet](phase-3/screenshots/real-overview-tablet.png), [mobile](phase-3/screenshots/real-overview-mobile.png). No live payment in that pass. |
| Refund service | 8 dedicated real-Neon cases with explicitly simulated RPC evidence passed. Source: `packages/db/test/refunds.integration.test.ts`. Newest observer/correction changes still need regression. Extended local harness `--refunds --collections` is authored but not run after the testing deferral. |
| Public accounting | 15 earlier synthetic Arkiv/source/writer cases passed. Actual [SDK public query](../../packages/arkiv/evidence/public-read.json) and [gateway-stopped public browser](../../apps/accountant/evidence/public-browser.json) returned zero entities. No positive signed receipt/accounting/renewal proof. |
| Recovery source | `packages/cre/recovery.ts` compiles to actual WASM; service APIs, current-state checks, stable rounds, failure fixture and delivery attribution exist. **Actual recovery simulation remains pending.** Earlier Phase1 simulation cannot substitute for it. |
| Latest static release checks | [Recorded compilation/schema results](phase-6/compilation.json): TypeScript including JS examples, both Next builds, real recovery WASM and Python syntax passed; migration0008 applied to isolated test then dev. These are not runtime/security tests. |
| Integration size | [Static source lines/bytes](phase-6/integration-inventory.json) include reusable helpers plus separate durable order system. Hands-on time/merchant validation unmeasured; new JS/Python execution deferred. |
| Operations/video | Supervisor, backup/isolated restore and bounded failed-publication repair commands exist; actual execution/restore checks deferred. [Demo script](../demo-script.md) exists; human narration/final video absent. |

Current open proof queue is [release-checklist.md](../release-checklist.md). No fabricated transaction hash, entity key, successful recovery, DON deployment, human narration, customer adoption or eligibility is supplied.
