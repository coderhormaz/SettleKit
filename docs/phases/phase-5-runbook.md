# CRE recovery operation and proof

`packages/cre/recovery.ts` uses the real pinned SDK and compiles to WASM. Actual recovery simulation/recovered-order proof is **pending**. Phase 1's successful CLI result proves only the earlier Whitechain/diagnostic-API route. No DON deployment is claimed.

## Prerequisites

Use a configured verified router, canonical accepted external-store payment, fresh source/onchain policy, matching gateway/store secrets and the durable independent store. Local-chain runs must be labeled local; sponsor proof needs the specified USDT/Whitechain1874. Existing `.tools` CLI/Bun are verified; overrides `CRE_CLI_PATH` / `BUN_PATH` select explicitly installed tools. Interactive login is completed for this workspace. Never add `--broadcast`.

`RECOVERY_SERVICE_TOKEN` is a separate 64-hex service capability; merchant sessions/API keys cannot use recovery APIs. `CRE_MERCHANT_WALLET` selects the merchant. The default independent order API is `<STORE_ORIGIN>/api/orders`; its bearer secret must match. The preparer writes ignored config/secrets only. Sepolia in project.yaml is simulator bootstrap only; actual payment evidence is Whitechain HTTP/RPC.

## Controlled demonstration

1. Privately enable `ALLOW_DEVELOPMENT_FAILURES=true`, `DEVELOPMENT_DELIVERY_ATTEMPTS=1`, `STORE_DEVELOPMENT_FAILURE_TOKEN` and matching `DEMO_MERCHANT_ID` on loopback services. Restart affected processes. Only the named merchant's initial external-store delivery gets the one-attempt fixture.
2. `pnpm recovery:demo arm` fails one valid signed financial notification before fulfillment; `endpoint.test` does not consume it.
3. Create/pay the 25-USDT store order. Wait for canonical acceptance and dead notification; order must remain pending/unfulfilled. Inspect dashboard Webhooks and `pnpm recovery:demo inspect`. Inspection never executes recovery.
4. `pnpm recovery:demo disable` restores the receiver. Keep the original retry exhausted and avoid merchant replay so it cannot receive CRE credit.
5. Compile or actually simulate:

```powershell
pnpm cre:compile
pnpm cre:recover
```

`cre:compile` performs no simulation. `cre:recover` prepares private config, compiles and invokes the actual CLI recovery-settings target. A successful CLI command writes sanitized log/source/WASM hashes under `docs/evidence/phase-5/`. No-candidate/refused output is not successful recovery evidence.

6. Inspect the normal worker's delivery, persisted recovery intent, `recovery.requested` / `recovery.delivered` audit, dashboard CRE timestamp, actual merchant payment association and `fulfillment_count=1`. Confirm no second charge/refund. Repeat the workflow: no second fulfillment.
7. Restore `ALLOW_DEVELOPMENT_FAILURES=false` and `DEVELOPMENT_DELIVERY_ATTEMPTS=5`; restart affected processes. Keep all test keys private.

## Verification matrix

CRE consensus selects a bounded candidate and verifies chain/router/code/deployment range, canonical receipt/block/event, exact association/amount/token/deadline and two-block inclusion. It reads the separate authenticated merchant API and fresh gateway eligibility. Consensus verification finishes before side-effect POST. Backend independently rechecks current source/refund/version/order state and schedules only the existing event with durable idempotency/cooldown/cap.

The workflow uses a shared trigger-time slot to rotate its one-candidate selection across failed notifications; one permanently ineligible order cannot pin every run to the first row. The service also supports ordinary cursor pagination. Receipt, canonical block and log must independently match the same transaction/block number/hash before decoding the financial association. These latest paths still require runtime regression.

| State | Outcome |
| --- | --- |
| Failed notification, matching pending order, eligible accepted payment | Queue existing notification; receiver still checks fresh grant |
| Matching fulfilled order | Acknowledge/no new fulfillment |
| Refund intent/partial/full refund, cancelled/review/blocked/orphaned | Refuse new fulfillment |
| Stale/mismatched association or unavailable required evidence | Refuse/fail closed |
| Duplicate node/run for one round | Same persisted outcome |
| More than 3 rounds or 60-second cooldown | Refuse/cool down |

Service credentials prove authority, not that the CLI ran. Preserve actual CLI log/hashes plus before/after private ledger/order outcome. New matrix/runtime verification is deferred; funded payment/publication remain separate gates.
