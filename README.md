# SettleKit

Screened USDT checkout on Whitechain, same-chain refunds, a premium merchant dashboard, independently verifiable accounting records, and recovery of missed payment notifications.

**Status:** Phase 2 is authorized. The router, screened checkout, canonical observer, signed notifications and separate durable store are implemented with local tests. Funded Whitechain deployment/source verification/payment and the Phase 1 Arkiv signed write remain pending user-deferred funding. Public app hosting is deferred; Phases 3 and 4 are now authorized.

## Start here

- [Six-phase implementation plan](IMPLEMENTATION_PLAN.md): selected Next.js + Neon PostgreSQL stack, ordered work, prerequisites, exit checks and checkpoints. Wallet-signature login; local app/worker development; public app hosting deferred.
- [Detailed project handoff](PROJECT_HANDOFF.md): product decisions, sponsor requirements/resources, current technology candidates, architecture, security, dashboard inventory, tests and demo.
- [Persistent project memory](MEMORY.md): accepted decisions and user preferences for new chats.
- [Current progress](PROGRESS.md): completed work, unverified gates and next actions.
- [Agent instructions](AGENTS.md): scope and build/checkpoint rules.
- [Phase 1 execution/evidence](docs/phases/phase-1.md), [evidence index](docs/evidence/index.md), [installed versions](docs/versions.md) and [design system](DESIGN.md).

## Agreed sponsor integrations

| Sponsor | Track | Role |
| --- | --- | --- |
| Whitechain | [Operate · Stablecoin Payments for Business](https://ethglobal.com/events/mumbai/prizes/whitechain) | USDT payments and full/partial refunds on Whitechain Sepolia |
| Arkiv | [Build on Arkiv (from scratch)](https://ethglobal.com/events/mumbai/prizes/arkiv) | Queryable receipts, independent accounting and exports |
| Chainlink | [Best workflow with CRE](https://ethglobal.com/events/mumbai/prizes/chainlink) | Compare blockchain and store state; recover eligible failed notifications |

The actual CRE HTTP/Whitechain-RPC feasibility simulation passed; payment recovery, native support and prize eligibility remain separate gates. Arc and ENS are excluded from the accepted MVP.

## Product requirements

- Minimal website integration through REST, hosted checkout and a small merchant webhook/order-state adapter.
- Mandatory wallet screening with named sources, explicit freshness/coverage and execution-time authorization controls.
- Merchant-authorized refunds in the original USDT on Whitechain to the original payer.
- Working, isolated merchant dashboards for payments, links, invoices, customers, refunds, risk cases, keys, webhooks, reports and settings.
- Accurate data, complete UI states and premium responsive design.
- Idempotent fulfillment, durable delivery state and evidence-backed recovery.

Screening enforces configured checks; it cannot guarantee all funds are lawful or prevent direct unsolicited transfers to public wallets. Production use needs verified data-provider coverage and the applicable legal/compliance process. The hackathon build uses test tokens.

## Run the local foundation

Use a supported Node LTS and pnpm 11.25.0. The lockfile is committed. Keep an existing local `.env`; for a fresh checkout, copy `.env.example` and fill it privately. Runtime `DATABASE_URL` is a limited Neon role on a dedicated development branch; `DATABASE_URL_UNPOOLED` is its direct migration credential. TLS uses `verify-full`. Never use a customer/shared default database for integration tests.

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm screening:import
pnpm dev
```

Open **http://127.0.0.1:3000** (the origin must match `APP_ORIGIN`). Connect an injected EVM wallet and sign the exact login message; no approval/token transfer occurs. Save the business name/website, inspect the proven settlement address and current configured checks. A separate settlement wallet requires its own ownership signature. Unknown/stale/unavailable source data cannot show passed checks.

In a second terminal run `pnpm worker` for source refresh and persisted screening jobs. Stop it with Ctrl+C. The app and worker use Neon, so local startup is not an offline database mode. No merchant-facing infrastructure configuration is exposed.

```powershell
pnpm typecheck
pnpm test:unit
pnpm build
pnpm check:imports
# Actual isolated database/browser checks need TEST_DATABASE_* and TEST_DATABASE_ISOLATED=true.
pnpm exec tsx --env-file=.env packages/db/src/migrate.ts --test
pnpm test:db
pnpm exec playwright install chromium
pnpm test:browser
```

Phase 1 baseline: 37 unit/database tests and 3 browser tests passed. Current Phase 2 checks and their exact fixture/live boundaries are tracked in [progress](PROGRESS.md) and the [evidence index](docs/evidence/index.md). Browser tests use a Node-held throwaway signer with real server verification/persistence; the session-expiry UI test deliberately injects a 401 response. Desktop/tablet/mobile screenshots were inspected; visual review returned ship for that scope. CI runs secret-free typing/unit/build checks; live database/browser/sponsor proofs remain separate.

## Sponsor feasibility and pending funding

Real commands/evidence are in `packages/cre/README.md` and `docs/evidence/index.md`. Whitechain uses the exact sponsor USDT; zero-amount `eth_call` success is not a signed payment. Arkiv owner queries work from the SDK and a separately served public browser, but the writer has zero tGLM and no entity yet. The actual CRE simulation reads Whitechain HTTP/RPC plus a separate diagnostic merchant API; supported Sepolia configuration only bootstraps the CLI. It does not prove native Whitechain support, live DON execution, payment recovery or prize eligibility.

The user deferred test-wallet funding. Once funded, resume the existing scripts and record actual transaction/entity proof before completing Phase 1. Test keys stay only in ignored `data/phase-1-wallets.json`; database and access credentials stay out of Git/browser/logs. See `PROGRESS.md` for exact outstanding gates. Phase 2 implementation is authorized; live funded evidence remains open.

## Development checkpoints

Preserve existing history and push each coherent, appropriately tested milestone to this repository throughout the build. Do not accumulate the entire project into a single final commit. Keep project memory, validation results and real evidence current. Never commit secrets or fabricate progress.

For every requested phase: prepare/review the detailed plan and relevant sponsor docs, use the available design skills, implement complete features, test real persistence/integrations, inspect responsive UI, fix findings, then report verified results. The database choice is Neon PostgreSQL; the app and worker initially run locally. Actual implementation and evidence are recorded in the linked phase documents.

Phases 3 and 4 are authorized. Preserve the funded proof gates and wait before Phase 5. See the [Phase 2 plan](docs/phases/phase-2.md), [local runbook](docs/phases/phase-2-runbook.md) and [store adapter](examples/store/README.md).
