# Submission and video guide (brief)

Updated: 7 November 2026. This is a practical checklist for the **remaining human/live-evidence** work. Do **not** fabricate hashes, entity keys, screenshots, metrics, merchant validation, or eligibility claims. Re-check the live [ETHGlobal Mumbai prizes](https://ethglobal.com/events/mumbai/prizes) pages (Whitechain, Arkiv, Chainlink) before submitting.

## Before recording the video

Complete these gates and save evidence as you go:

| Gate | How (brief) | Evidence to keep |
|---|---|---|
| Fund test roles (deferred) | Fund WBT + exact sponsor USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` and gas on Whitechain Sepolia `1874` for payer/merchant/deployer/policy roles; fund Arkiv writer `0xAB5C7220E7d98D57181346d00D6E7957f42Af486` with tGLM. Keep keys in `.env` only. | Role list/addresses (no secrets), funding tx refs if useful. |
| Deploy + verify router | Use [packages/contracts/README.md](../packages/contracts/README.md) with exact sponsor USDT. Set `WHITECHAIN_ROUTER_ADDRESS`, `WHITECHAIN_ROUTER_CODE_HASH`, `WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK`. Restart stack. Run read-only policy sync first; broadcast only when intentionally funded/authorized. | Explorer-verified contract, deployment tx, compiler/constructor/settings. |
| Live 25 USDT payment | Create checkout, pay with sponsor USDT, confirm signed notification/store fulfillment from real chain evidence. | **Payment explorer tx link** (add to [README.md](../README.md)), dashboard/store screenshots. |
| Live 5 USDT refund | Merchant-authorized refund to **original payer**, same USDT/chain. | Refund explorer tx link, dashboard evidence. |
| Independent accounting (25/5/20) | Verify accountant/dashboard/CSV show correct gross/refunded/net from real records. | Screenshots/CSV, accountant query context. |
| Signed Arkiv receipts | Let worker publish payment/refund/correction records; verify public reads. | Entity keys, reproducible query (`node --import tsx packages/arkiv/scripts/public-read.ts` or accountant), writer/merchant scope. |
| CRE recovery on funded payment | Re-run actual CRE workflow against the funded Whitechain scenario per [phase-5-runbook.md](phases/phase-5-runbook.md). | Sanitized CLI/config/output, recovery audit, **one** fulfillment proof. Label as CLI simulation unless a real verified deployment ran. |

## Record the 2–4 minute video (human narration)

Use **real human narration** (not AI voice), 720p+. Show only what you can prove:

1. Merchant/store context and screened checkout (testnet labeled).
2. **25 USDT** sponsor-USDT payment on Whitechain Sepolia + store fulfillment.
3. Failed notification → **actual CRE recovery** → single fulfillment (show before/after evidence).
4. **5 USDT refund** to original payer + dashboard state.
5. **Independent accountant** showing 25 gross / 5 refunded / 20 net from public/verified records (and note gateway-independence if demonstrated).

State limitations plainly: testnet, screening is time-scoped/not a lawful-funds guarantee, local vs live evidence boundaries, no custodial balance/freezing claims.

## Final repo/submission checks

- [ ] [README.md](../README.md): add **actual Whitechain payment transaction explorer link**; keep limitations truthful.
- [ ] [WHITECHAIN_FEEDBACK.md](../WHITECHAIN_FEEDBACK.md), [CHAINLINK_FEEDBACK.md](../CHAINLINK_FEEDBACK.md), [arkiv/*.md](../arkiv/): update with any real live friction/evidence (no sponsor messages sent unless user authorizes).
- [ ] [AI_USAGE.md](../AI_USAGE.md), [LICENSE](../LICENSE), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md): accurate.
- [ ] [docs/evidence/index.md](evidence/index.md): add real tx/entity/CRE evidence when obtained.
- [ ] Run `corepack pnpm audit:secrets` before push; keep `.env`, backups, keys private.
- [ ] **User action:** select Whitechain Operate, Arkiv Build from scratch, Chainlink CRE in ETHGlobal dashboard. **Published deadline was 7 Nov 2026 09:00 IST** — do not claim timely eligibility if submitting late.

## Quick command reminders

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate
node --env-file=.env --import tsx examples/store/src/migrate.ts
corepack pnpm screening:import
corepack pnpm build:all
corepack pnpm stack start   # or stack status / stack stop
corepack pnpm audit:secrets
node --import tsx packages/arkiv/scripts/public-read.ts
```