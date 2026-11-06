# Evidence index

Updated 6 November 2026 (IST). Phase 1 is in progress with two user-deferred funded testnet gates. This index distinguishes code/local checks, live reads, signed writes and real CRE simulation.

| Requirement / gate | Implementation and reproducible command | Evidence / actual outcome |
| --- | --- | --- |
| Compatible workspace | Root lockfile, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` | Installed pins/compatibility failures in [versions](../versions.md); typecheck and production build passed. |
| Exact private monetary persistence and atomic state/jobs | `packages/db`; `pnpm test` with isolated test configuration | 37 tests passed, including 8 real Neon checks. Round trips, fractional/overflow rejection, rollback/outbox, SIWE races, isolation, source-health ordering, job fences and disconnect/idempotent retry. [Neon metadata](phase-1/neon-foundation.json). |
| Required screening baseline | `packages/screening`, worker; `pnpm screening:import` | Actual official import persisted 19,555 records / 124 ETH identifier occurrences; [provenance](phase-1/screening-source.json). Includes synthetic edge-case tests, distinct from live source read. |
| Usable identity/setup | `apps/gateway`; `pnpm test:browser` | 3 browser tests passed using actual server signatures/persistence and an injected test wallet; session-expiry UI uses an HTTP fixture. [Desktop](phase-1/screenshots/desktop.png), [tablet](phase-1/screenshots/tablet.png), [mobile](phase-1/screenshots/mobile.png), [saved desktop](phase-1/screenshots/authenticated-desktop.png), [saved mobile](phase-1/screenshots/authenticated-mobile.png); fresh visual review: ship. No customer adoption claim. |
| Whitechain exact network/token | `packages/feasibility/src/whitechain.ts` | [Live read-only evidence](phase-1/whitechain-network.json). Zero-value `eth_call` is simulation, not a transaction. [Test roles/balances](phase-1/whitechain-test-wallets.json) remain unfunded. |
| Deployed Whitechain router/payment | Phase 2, not implemented | No deployed router/payment/source-verification claim. |
| Arkiv real SDK query and independent browser | `packages/feasibility/src/arkiv.ts`, `arkiv-browser.ts` | [SDK query](phase-1/arkiv-network.json), [independent public browser query](phase-1/arkiv-browser.json); empty writer results, no private browser credential or gateway API. |
| Arkiv signed entity round trip | Same reproducible script after funding | **Pending user-deferred writer funding.** No entity key or signed-write claim. |
| CRE Whitechain HTTP + separate API | `packages/cre`; commands in its README | [Actual successful CLI simulation](phase-1/cre-simulation.json), [run log](phase-1/cre-simulation.log), [native/bootstrap limitation](phase-1/cre-native-network-check.json). Proves route capability, not payment recovery/DON deployment/eligibility. |
| Contract toolchain | `packages/contracts`, compile/smoke scripts | [Actual Hardhat/solc/prague compilation](phase-1/contract-toolchain.json). Smoke only, no payment router. |

Selected sponsor requirements remain in the handoff and phase plan. Later phases add actual router/payment/refund/Arkiv accounting/recovery evidence rather than relabeling these feasibility probes.
