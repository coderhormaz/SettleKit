# Release checklist

Updated 7 November 2026. All phases are authorized; the user deferred further tests. Boxes below describe the **later verification pass**, not completed work. Static builds, old snapshots and funded proof are distinct.

- [ ] Fresh frozen install; replay migrations0000–0008/store001–002 on isolated Neon targets; verify limited pooled runtime roles.
- [ ] `pnpm typecheck`, `pnpm build:all`, `pnpm check:imports`, contract compile, `pnpm cre:compile`; stage review and `pnpm audit:secrets` against both client bundles.
- [ ] Run the unit/contract/database/browser suites with isolated URLs; inspect current results rather than inheriting old counts.

```powershell
pnpm test:unit
pnpm test:contracts
node --env-file=.env --import tsx packages/db/src/migrate.ts --test
node --env-file=.env --import tsx examples/store/src/migrate.ts --test
pnpm test:db
pnpm test:browser
node --env-file=.env --import tsx packages/contracts/scripts/local-payment-flow.ts --refunds --collections
```

Full root suite: `pnpm test`. The extended local harness uses mock token/EVM and synthetic Arkiv metadata; it does not prove a live signed entity. CI retains automatic secret-free build/unit/contract checks on authorized pushes. No live secrets/funding go into CI.

- [ ] Recovery auth/round/idempotency/cooldown/exhaustion, stale source/policy/version/order, lease/manual replay races and false CRE attribution.
- [ ] Actual controlled failure→`pnpm cre:recover`→existing delivery→one store fulfillment, duplicate run and unsafe matrix from the [runbook](phases/phase-5-runbook.md).
- [ ] Refund reservations/cancel windows/expiry/concurrency/reorg/re-inclusion and final wallet flow; canonical money plus missing-local-auth review.
- [ ] Public correction timestamp backfill/stale observers, ambiguous write/query-first repair, global writer leases, unfunded repair, expiry/renewal and incomplete range coverage.
- [ ] Supervisor start/status/stop/port conflict/interrupted leases; actual PostgreSQL 17 dump/explicit isolated restore.
- [ ] New JS exports and Python service: invalid bodies/HMAC, redirects/DNS/deadlines, actual durable callback/idempotency. Syntax checks are insufficient.
- [ ] All dashboard CRUD/filter/pagination/secret rotation/session actions; wallet setup and tenant isolation.
- [ ] Store/link/invoice checkout, pause/deactivation/void/expiry, ambiguous submissions and source/RPC/wallet/allowance/gas failures.
- [ ] Desktop 1440×900/tablet 768×1024/mobile 390×844, keyboard/dialog/reduced-motion inspection of all four surfaces; later UI changes require later inspection.
- [ ] Gateway-stopped accountant with **positive** signed entities: filters/paging/CSV,25/5/20 figures, source-range completeness and expired/forged/corrective records.
- [ ] Funded actual source-verified Whitechain router/policy,25 specified-USDT payment and5 original-payer refund, genuine explorer/code/deployment evidence.
- [ ] Signed Rabdi payment/refund entities with actual keys/transactions and actual CRE recovery simulation. DON execution remains separate.
- [ ] Human narration/2–4minute video with actual proof timestamps, truthful AI/contribution disclosure and unmeasured integration time labeled.
- [ ] Sponsor criteria/feedback/evidence reflect reality; normal push/remote SHA/CI verification. Hosting/submission/customer funds/sponsor messages require applicable authorization.
