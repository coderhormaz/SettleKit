# Phase 5 — real CRE reconciliation and safe recovery

Authorized 6 November 2026 (IST). All phases are authorized; finish incomplete Phase 3/4 integration in dependency order. Phase 1's real CLI HTTP/Whitechain route simulation passed. Live payment/refund and Arkiv write proofs remain user-deferred funding gates.

## Scope, architecture and review

7 November verification: actual recovery CLI simulation and persisted one-fulfillment proof now pass against the local EVM/mock token, separate merchant HTTP API and real isolated Neon. Eleven recovery auth/race/cap/attribution checks pass as part of the clean114-test root run. See [recovery evidence](../evidence/phase-5/local-recovery-flow.json) and [CLI hashes/log](../evidence/phase-5/cre-recovery-simulation.json). This is separate from Phase1's route proof and the pending funded Whitechain recovery run. Main agent only; testing resumed.

Use the installed CRE SDK1.23.0/CLI1.39.0/Bun1.4.4/TypeScript 5.9.3. Rechecked [selected CRE track](https://ethglobal.com/events/mumbai/prizes/chainlink) and [HTTP capability](https://docs.chain.link/cre/capabilities/http) on 6 November2026: meaningful orchestration and actual CLI simulation are required; deployed DON execution is separate. Preserve the proven HTTP route and documented Sepolia CLI-bootstrap limitation. No CCIP/extra settlement chain/native Whitechain claim.

Chosen approach: service-authenticated bounded candidate/current-state API + real CRE HTTP receipt/order reads + idempotent recovery intent + existing normal signed delivery worker. Alternatives rejected: a Node timer is not CRE evidence; allowing CRE to spend/refund violates custody/merchant authorization; trusting a candidate or old acceptance without current checks can fulfill cancelled/refunded/blocked orders.

FILES TO CREATE: `packages/db/src/recovery.ts` and typed recovery ledger/migration/tests; service-authenticated `/api/recovery/*` routes; `packages/cre/recovery.ts`, private simulation-config preparer and actual CLI evidence script; development-only failure injector and local end-to-end recovery fixture harness; current-state matrix/runbook/evidence.

FILES TO MODIFY: worker dispatch/audit actor, public-safe shared receipt types/ABI, CRE project/workflow configs and docs, actual store order API, dashboard delivery/recovery labels without exposing CRE administration.

- [x] 1. Review current payment/refund/hold/order/confirmation/policy model and SDK/CLI APIs; preserve failure gates.
- [x] 2. Add service-only strong credential with timing-safe auth, bounded paginated candidates, approved configured merchant endpoints and minimal current-state responses; no arbitrary trigger URL.
- [x] 3. Implement backend recovery intents with stable payment/event/version identity, cooldown/attempt cap, canonical/source/refund/order revalidation and atomic existing-event scheduling. No fresh charge or refund.
- [x] 4. Real CRE workflow reads chain ID/router receipt/block/event through HTTP, matches invoice/payer/merchant/token/amount/log/hash/soft confirmation and current merchant order; rejects unsafe states, normalizes data for consensus.
- [x] 5. CRE submits authenticated recovery action; backend rechecks latest state/version and queues existing stable notification. Actor audit must say CRE only for an actual CRE-originated request.
- [x] 6. Explicit local-only failure injection makes initial delivery fail/reach labeled recoverable state; restore receiver then run real CLI simulation and show actual recovery/one fulfillment. Disable unrelated automatic recovery so it cannot be credited to CRE.
- [x] 7. Verify replay and unsafe matrix, preserve sanitized config/source/WASM/run/result proof and push milestone. Eleven real-Neon recovery checks and actual local CLI/one-fulfillment evidence are recorded; funded Whitechain repeat remains a separate exit gate.

Review constraints: ordinary operators/merchant sessions cannot forge service auth; credentials never enter browser/build/log/Git. Compare current canonical monetary state separately from delivery. Nonterminal refund intent holds before executable refund payload; refunded/partial-refund/cancelled/orphaned/blocked/stale/mismatched/absent orders do not gain fulfillment. Fully fulfilled order is a no-op. Current key/endpoint failure needs repair; capped budgets cannot reset infinitely. All consensus-side HTTP results are bounded, validated and stable; side-effect endpoint is idempotent across nodes/repeated runs.

Acceptance: repeated CRE run cannot duplicate charge/fulfillment/totals; actual CLI simulation joins chain and separate merchant API and initiates the recovery recorded in audit. Local EVM/payment fixtures are distinct from the still-pending actual Whitechain payment run. If CLI login/access is unavailable, retain working source/tests and precise failed command; do not relabel Node recovery as CRE execution. Dashboard loading/error/dead/recovered states use real persisted data; infrastructure stays private.
