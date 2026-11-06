# SettleKit

Screened USDT checkout on Whitechain, direct merchant settlement, original-payer refunds, a merchant dashboard, independent accounting and recovery of failed store notifications through Chainlink CRE.

**Status, 7 November 2026:** source for all six authorized phases is present. Further test runs were deferred by the user. Static compilation does not establish the remaining live gates: funded Whitechain deployment/payment/refund, signed Arkiv receipts and an actual CRE recovery run. See the [implementation audit](docs/IMPLEMENTATION_AUDIT.md) and [evidence index](docs/evidence/index.md).

## Product and stack

- Wallet-first merchant login and verified settlement ownership.
- Hosted checkout, scoped keys, signed notifications and a separate durable store with idempotent fulfillment.
- Responsive dashboard: overview, payments/refund details, payment links, invoices, contacts, developers, webhooks, reports, risk reviews, settings and audit.
- Full/partial merchant-funded refunds to the original payer in the original token/chain.
- Arkiv payment/refund/correction publication and an independent accountant with source verification, coverage and CSV.
- Actual CRE SDK workflow comparing chain evidence, current eligibility and the separate order API before recovering the existing notification. CRE never moves money.

Next.js 16 / React 19 / TypeScript 5.9; Neon PostgreSQL 17 / Drizzle / pg; viem / wagmi; Hardhat / OpenZeppelin; Arkiv SDK and CRE SDK. Exact compatible versions are pinned in the lockfile and [version notes](docs/versions.md). Local app/worker operation is selected; public application hosting remains deferred.

Payments/refunds use **Whitechain Sepolia 1874**, USDT **`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`**, six decimals. Screening enforces configured address lists/freshness; it does not guarantee lawful funds or provide source-of-funds tracing. Unsolicited transfers never satisfy an invoice. Arc, ENS and bridges are excluded.

## Local startup

Use Node 22.13+ LTS and pnpm 11.25.0. Preserve an existing ignored `.env`. On a fresh checkout copy `.env.example` and privately configure dedicated Neon gateway/store databases, pooled limited-role runtime URLs, direct migration URLs and server credentials. Use TLS `verify-full`. Never put keys in browser code or chat.

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
node --env-file=.env --import tsx examples/store/src/migrate.ts
pnpm screening:import
pnpm build:all
pnpm stack start
```

| Surface | Local address |
| --- | --- |
| Wallet/business setup | http://127.0.0.1:3000 |
| Merchant dashboard | http://127.0.0.1:3000/dashboard |
| Independent Fieldwork store | http://127.0.0.1:3200 |
| Independent accountant | http://127.0.0.1:3400 |

Run `pnpm stack status` / `pnpm stack stop` in another terminal. The supervisor manages only its own children and refuses occupied ports. Existing standalone processes must be stopped through their original terminal. It does not build, migrate or broadcast policy transactions. Without a verified router/current onchain policy, checkout remains unavailable. See [operator setup](docs/operations.md).

For separate terminals use `pnpm dev`, `pnpm store`, `pnpm worker`, and `pnpm --filter @settlekit/accountant dev`. Do not combine them with services already using the same ports.

## Merchant integration and evidence

Sign in, save the approved business origin, prove settlement ownership, create a scoped server key and configure the webhook/authenticated order-read API. Your backend creates checkout using the persisted order price. Your receiver verifies raw HMAC, asks for current eligibility, and commits receipt deduplication plus one fulfillment atomically. A return URL never proves payment.

Use the [complete independent store](examples/store/README.md), [JavaScript adapter](examples/javascript/README.md) or [Python HTTP adapter](examples/python/README.md). Include order reads, configuration, bounded transport and durable callbacks when estimating work; integration time has not been measured.

Historical verification includes89 root checks, 26 local contract checks,13 browser cases, a separate real dashboard CRUD browser case and 8 refund database cases. These are different scopes/snapshots, not one current-suite total. New recovery/correction/tooling changes require the deferred [release pass](docs/release-checklist.md).

Live evidence proves official OFAC ingestion, Whitechain read-only metadata, public Arkiv queries and the Phase 1 actual CRE route simulation. Local mock-token payment/fulfillment evidence is separate. No signed Arkiv entity, funded Whitechain payment/refund, recovered CRE order, deployed DON, merchant validation or completed narrated video is claimed.

## Review

- [Six-phase plan](IMPLEMENTATION_PLAN.md), [detailed plans](docs/phases/), [handoff](PROJECT_HANDOFF.md), [memory](MEMORY.md), [progress](PROGRESS.md).
- [Operations](docs/operations.md), [CRE recovery](docs/phases/phase-5-runbook.md), [release checklist](docs/release-checklist.md), [demo script](docs/demo-script.md).
- [Product](PRODUCT.md), [design](DESIGN.md), [API contract](docs/phases/phase-3-api.md), [public schema](arkiv/schema.md).
- [License](LICENSE), [third-party attribution](THIRD_PARTY_NOTICES.md), [AI use](AI_USAGE.md), [Whitechain feedback](WHITECHAIN_FEEDBACK.md), [Chainlink feedback](CHAINLINK_FEEDBACK.md), [Arkiv criteria](arkiv/).

Selected tracks: [Whitechain · Operate](https://ethglobal.com/events/mumbai/prizes/whitechain), [Arkiv · Build from scratch](https://ethglobal.com/events/mumbai/prizes/arkiv), [Chainlink · Best workflow with CRE](https://ethglobal.com/events/mumbai/prizes/chainlink). Requirements map to implementation/evidence in the audit. Public hosting, customer funds, sponsor messages and submission need applicable user authorization. Work after the deadline is not a claim of timely entry or eligibility.
