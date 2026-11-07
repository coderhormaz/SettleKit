# SettleKit handoff

Updated: 7 November 2026 (IST). This is the practical connection and closeout handoff for the current repository state. Read [AGENTS.md](AGENTS.md), [MEMORY.md](MEMORY.md), [PROGRESS.md](PROGRESS.md), [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md), [docs/release-checklist.md](docs/release-checklist.md), and [docs/operations.md](docs/operations.md) before making live or submission changes. For the remaining live/submission steps and the 2–4 minute human-narrated video checklist, use **[docs/SUBMISSION_GUIDE.md](docs/SUBMISSION_GUIDE.md)**.

## What is done

- All six authorized phases have implementation source and local runtime evidence. The full local EVM/mock-token + production HTTP + isolated Neon flow passes for screened checkout, one idempotent store fulfillment, original-payer refunds, 25/5/20 accounting, and actual CRE CLI recovery with one fulfillment.
- Latest recorded local checks: **114/114 root tests**, **26 contract tests**, **16 browser tests**, **7 Python checks**; production builds/type/import checks pass. Exact scopes and boundaries are in the release checklist and audit. Historical counts overlap and must not be summed.
- Merchant surfaces work locally: wallet onboarding, dashboard (overview/payments/links/invoices/contacts/developers/webhooks/reports/risk/settings/audit), hosted checkout, separate Fieldwork store, and independent accountant.
- Private Neon databases/roles, migrations, screening import, and local supervisor/startup scripts are in place. `.env` exists locally and is ignored; keep it private.

## What is left to connect

These are real external gates. Do **not** claim them complete until you have actual evidence (transaction hashes, explorer links, entity keys, screenshots/logs, or a final video file). Test-wallet funding and public hosting were explicitly deferred; sponsor messages/submission/production funds require applicable user authorization.

### 1. Fund and configure Whitechain test roles

Provide testnet assets/configuration for the roles already designed in the app (keep private keys out of Git/chat/browser bundles/logs):

| Role / need | Address / config reference | What to connect |
| --- | --- | --- |
| Arkiv writer | `0xAB5C7220E7d98D57181346d00D6E7957f42Af486` (`ARKIV_PUBLIC_WRITER_ADDRESS`) | Fund with **tGLM** for Rabdi writes/renewal; set `ARKIV_WRITER_PRIVATE_KEY` / `ARKIV_ACCESS_KEY` as needed. |
| Payer / buyer test wallet | `0x2D3C8DdC302F86C6a88E7673E0094C6730dF9A5A` (recorded in project docs) | Fund with **WBT** gas and the exact sponsor **USDT** `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` on Whitechain Sepolia `1874`. |
| Merchant settlement wallet | `0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192` (recorded default/demo context) | Fund with gas for merchant-authorized refund transactions and ensure settlement ownership/proof matches the intended merchant. |
| Router deployer | `WHITECHAIN_DEPLOYER_PRIVATE_KEY` | Fund with WBT gas for deployment/verification transactions. |
| Policy admin / payment authorizer | `POLICY_ADMIN_PRIVATE_KEY`, `PAYMENT_AUTHORIZER_PRIVATE_KEY`, related addresses | Fund/configure as separate platform roles. Run read-only `pnpm policy:sync`; broadcast only when intentionally authorized and funded. |

Do **not** substitute a self-minted token, another chain, or Arc/ENS/bridges.

### 2. Deploy and verify the actual Whitechain router

1. Follow [packages/contracts/README.md](packages/contracts/README.md) with the funded deployer and exact sponsor USDT.
2. Record deployment evidence: router address, code hash, deployment block, compiler/optimizer/EVM settings, constructor params, explorer verification link, and deployment tx.
3. Set in `.env` (server-only): `WHITECHAIN_ROUTER_ADDRESS`, `WHITECHAIN_ROUTER_CODE_HASH`, `WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK`.
4. Restart local services (`pnpm stack stop && pnpm stack start` or the equivalent owned processes) after config changes.
5. Verify checkout becomes executable only after the verified router/current onchain policy is present.

**Evidence still needed:** source-verified router on Whitechain Sepolia, actual sponsor-USDT payment explorer link, and refund explorer link. Add the payment transaction link to [README.md](README.md) where the placeholder currently states it is pending.

### 3. Run a real funded payment/refund on Whitechain

Using the deployed router and funded payer/merchant wallets:

1. Create a checkout/payment for the demo amount (25 USDT where used in evidence).
2. Complete wallet approval + payment on Whitechain Sepolia with the exact sponsor USDT.
3. Confirm signed webhook/store fulfillment and dashboard state from real chain evidence.
4. Issue a merchant-authorized partial refund (5 USDT where used in evidence) to the **original payer** in the same token/chain.
5. Capture explorer links, dashboard/accountant screenshots, and CSV/report output showing 25 gross / 5 refunded / 20 net where applicable.

**Evidence still needed:** funded live payment tx, funded live refund tx, and positive independent accounting over real records.

### 4. Publish signed Arkiv receipts and verify independent accounting

1. Ensure the Arkiv writer is funded and credentials are configured server-side.
2. Run/observe the worker/publication path until payment/refund/correction records (as applicable) are written.
3. Save actual entity keys, writer address, timestamps/expiry context, and a reproducible query.
4. Verify the independent accountant reads public records without the gateway history API and reconciles against Whitechain source evidence.
5. Run `node --import tsx packages/arkiv/scripts/public-read.ts` and/or use the accountant with the configured writer/merchant scope; an empty query is not proof.

**Evidence still needed:** signed Rabdi entities, reproducible query/output, renewal behavior evidence if exercised, and positive accountant reconciliation.

### 5. Repeat CRE recovery against a funded Whitechain payment

Local CRE CLI recovery already passed against local EVM evidence. To close the live gate:

1. Use the deployed router and a real funded Whitechain payment scenario.
2. Run the actual CRE workflow/simulation path documented in [docs/phases/phase-5-runbook.md](docs/phases/phase-5-runbook.md) and [CHAINLINK_FEEDBACK.md](CHAINLINK_FEEDBACK.md).
3. Preserve sanitized command/output, configuration, candidate/current-state evidence, and the resulting single store fulfillment/recovery audit.

Do **not** claim native Whitechain CRE support or DON deployment unless separately proven. Ordinary Node retry is not CRE proof.

### 6. Human and submission artifacts

| Item | Status | Action |
| --- | --- | --- |
| 2–4 minute narrated demo video | Pending | Record with real human narration (not AI voice). Show screened checkout, 25 USDT payment, failed notification + CRE recovery, 5 USDT refund, independent 25/5/20 accounting. Keep it truthful about local vs live evidence. |
| Merchant/developer validation | Not measured | Optional but valuable: run a real integration test with a developer/merchant and record honest feedback/time; do not fabricate results. |
| README payment tx link | Pending live tx | Add the actual Whitechain explorer payment link after funded proof. |
| Sponsor feedback files | Present, keep current | Review [WHITECHAIN_FEEDBACK.md](WHITECHAIN_FEEDBACK.md), [CHAINLINK_FEEDBACK.md](CHAINLINK_FEEDBACK.md), and `arkiv/*.md` after live runs; update with actual friction/evidence. |
| Submission/dashboard selections | User action | Select Whitechain Operate, Arkiv Build from scratch, and Chainlink CRE intentionally in the ETHGlobal dashboard if submitting. Work after the published deadline is not a claim of timely entry/eligibility. |
| Public hosting | Deferred | Local app/worker operation is current. Any public deployment/domain needs separate authorization and security/cost review. |

### 7. Operational checks before each live run

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
node --env-file=.env --import tsx examples/store/src/migrate.ts
pnpm screening:import
pnpm build:all
pnpm stack start
pnpm stack status
```

- Keep `.env` private; run `pnpm audit:secrets` before commits/pushes.
- Do not run database/browser/integrated suites in parallel against the isolated test screening snapshot.
- After router/policy/key/endpoint changes, restart affected services and verify the dashboard shows the expected current state.
- Use `pnpm receipts status` / `pnpm receipts retry` only as the documented operator repair path; retry does not prove a signed write.

## Evidence map

Use [docs/evidence/index.md](docs/evidence/index.md) as the source of truth. Key local artifacts:

- Payment/adapters: [docs/evidence/phase-2/local-payment-flow.json](docs/evidence/phase-2/local-payment-flow.json)
- Refund/collections: [docs/evidence/phase-4/local-refund-flow.json](docs/evidence/phase-4/local-refund-flow.json)
- CRE recovery: [docs/evidence/phase-5/local-recovery-flow.json](docs/evidence/phase-5/local-recovery-flow.json), [docs/evidence/phase-5/cre-recovery-simulation.json](docs/evidence/phase-5/cre-recovery-simulation.json), [docs/evidence/phase-5/cre-recovery-simulation.log](docs/evidence/phase-5/cre-recovery-simulation.log)
- Backup/restore and lifecycle: [docs/evidence/phase-6/backup-restore.json](docs/evidence/phase-6/backup-restore.json), [docs/evidence/phase-6/local-lifecycle.json](docs/evidence/phase-6/local-lifecycle.json)
- Independent accountant browser evidence: [apps/accountant/evidence/public-browser.json](apps/accountant/evidence/public-browser.json)

## Safety boundaries

- Never move customer funds, deploy publicly, send sponsor messages, or submit on behalf of the user without explicit authorization.
- Refunds go only to the original payer in the original USDT on Whitechain Sepolia. Merchant funds are never custodied or auto-moved by the API/CRE/AI.
- Screening is time-scoped and policy-bound; it is not a guarantee of lawful funds or complete tracing.
- Arkiv is public: no PII, private order details, secrets, or risk dossiers.
- Preserve Git history; use normal pushes; verify remote hashes. Keep secrets out of commits.