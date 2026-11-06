# Evidence index

Updated7November2026. All phases are authorized; main-agent-only testing resumed. Current verification below supersedes older snapshot counts. Local EVM, real Neon, actual CLI simulation, public reads and funded live proofs remain separate.

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

## Final phase3–6 verification

| Scope | Actual result / boundary |
| --- | --- |
| Root |114/114 tests across13files; actual isolated Neon plus explicit HTTP/RPC/source fixtures. Includes11 recovery,10 operation,8 refund and5 projection cases. |
| Contracts |26 local simulated-EVM cases; no live deployment. |
| Browser |16/16 Chromium flows, actual wallet-signature/Neon persistence and labeled interface/wallet/RPC fixtures. Desktop/tablet/mobile, nested dialogs/focus and refund retry states checked. |
| Python |7 standard-library tests, real local HTTP callback/redirect/response-limit checks and explicit current-state fixtures. Actual Python positive signed delivery/order read also executes in the combined harness. |
| Integrated local flow |[Payment/JS/Python](phase-2/local-payment-flow.json), [refund/collections](phase-4/local-refund-flow.json): production HTTP, real isolated Neon, local EDR/mock token; exact25–5–20 sums/CSV, one fulfillment, one-base-unit link/invoice payments, pause/deactivation/duplicates. Public verifier entity metadata is explicitly synthetic. |
| CRE |[Actual CLI simulation](phase-5/cre-recovery-simulation.json), [sanitized log](phase-5/cre-recovery-simulation.log), [persisted recovery/one fulfillment](phase-5/local-recovery-flow.json). Actual local chain + separate merchant API + real Neon, not DON execution or a funded Whitechain payment. |
| Public accountant |[Actual gateway-stopped browser](../../apps/accountant/evidence/public-browser.json), [SDK query](../../packages/arkiv/evidence/public-read.json): no gateway/private credentials, zero entities. Positive signed accounting/history completeness pending funding. |
| Operations |[Actual backup/isolated restore and six guards](phase-6/backup-restore.json), [supervisor lifecycle](phase-6/local-lifecycle.json), [complete verification record](phase-6/verification.json). Runtime app URLs unchanged by restore. |
| Integration effort |[Full source lines/bytes](phase-6/integration-inventory.json); includes helpers/durable order system and Python tests separately. Hands-on time/merchant validation unmeasured. |
| Open gates |Funded explorer-verified Whitechain deployment/payment/refund; signed Rabdi entities/renewal and positive independent accounting; funded Whitechain recovery; human-narrated video. Hosting/submission/customer funds/sponsor messages require applicable authorization. |

Earlier failed attempts are recorded in the audit: harness response-envelope error, transient Neon DNS/transport failures and a screening test fixture whose publication timestamp could exceed fetch time. Fixed/clean reruns are distinct from those failures. No screening bypass, TLS weakening or retry of ambiguous commits was introduced.
