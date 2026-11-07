# SettleKit

Screened USDT checkout on Whitechain, direct merchant settlement, original-payer refunds, a merchant dashboard, independent accounting and recovery of failed store notifications through Chainlink CRE.

**Status, 7 November 2026:** all six authorized phases have implementation source and the local runtime audit is complete. 114 root tests,26 contract tests,16 browser tests and7 Python checks pass. Actual local payment/refund execution, real CRE CLI recovery, independent merchant fulfillment and isolated backup/restore pass. Funded Whitechain deployment/payment/refund and signed Arkiv receipts remain open live gates. See the [implementation audit](docs/IMPLEMENTATION_AUDIT.md) and [evidence index](docs/evidence/index.md) for exact current checks and limitations.

## Product and stack

The [20-second social launch cut](brag-output/brag.mp4), [poster](brag-output/brag.jpg) and [share copy](brag-output/share-copy.txt) show the real UI with labelled local fixtures and original music. The [editable recipe and media checks](brag-output/README.md) preserve its source. This social asset does not replace the pending human-narrated demonstration or funded sponsor evidence.

- Wallet-first merchant login and verified settlement ownership.
- Hosted checkout, scoped keys, signed notifications and a separate durable store with idempotent fulfillment.
- Responsive dashboard: overview, payments/refund details, payment links, invoices, contacts, developers, webhooks, reports, risk reviews, settings and audit.
- Full/partial merchant-funded refunds to the original payer in the original token/chain.
- Arkiv payment/refund/correction publication and an independent accountant with source verification, coverage and CSV.
- Actual CRE SDK workflow comparing chain evidence, current eligibility and the separate order API before recovering the existing notification. CRE never moves money.

Next.js 16 / React 19 / TypeScript 5.9; Neon PostgreSQL 17 / Drizzle / pg; viem / wagmi; Hardhat / OpenZeppelin; Arkiv SDK and CRE SDK. Exact compatible versions are pinned in the lockfile and [version notes](docs/versions.md). Local app/worker operation is selected; public application hosting remains deferred.

Payments/refunds use **Whitechain Sepolia 1874**, USDT **`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`**, six decimals. Screening enforces configured address lists/freshness; it does not guarantee lawful funds or provide source-of-funds tracing. Unsolicited transfers never satisfy an invoice. Arc, ENS and bridges are excluded.

Whitechain settlement makes an order-bound stablecoin payment and its original-payer partial refund publicly verifiable by the merchant, customer and independent accountant. The router transfers directly to the merchant and emits evidence that another system can verify and reconcile without trusting SettleKit's private ledger. A regular payment rail does not expose these same programmable token transfers and public contract events on Whitechain.

**Whitechain payment transaction (required for submission):** _Pending funded deployment/payment — add the actual sponsor-USDT explorer tx link here before submission. Local mock-token transactions do not satisfy this requirement._

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

Run the root unit/isolated-Neon suite with `pnpm test`, contracts with `pnpm test:contracts`, and Chromium flows with `pnpm test:browser`. The [release checklist](docs/release-checklist.md) records current results and boundaries. Database/browser/integrated suites must run sequentially because they temporarily replace the isolated test screening snapshot.

Live evidence proves official OFAC ingestion, Whitechain read-only metadata and public Arkiv queries. Actual CRE recovery simulation has also run against the local EVM, separate merchant API and real isolated Neon databases; the one-fulfillment outcome is separately checked. This remains local mock-token proof. No signed Arkiv entity, funded Whitechain payment/refund, deployed DON, merchant validation or completed narrated video is claimed.

The configured public Arkiv writer is **`0xAB5C7220E7d98D57181346d00D6E7957f42Af486`**. It is unfunded and has not yet written signed entities. Run `node --import tsx packages/arkiv/scripts/public-read.ts` for an actual public SDK query scoped to this writer/creator and the demo merchant, or use the independent accountant. An empty query is not proof of complete accounting history. Entity schema, ownership, retention and indexed fields are documented in [arkiv/schema.md](arkiv/schema.md).

## Review

- [Submission/video guide](docs/SUBMISSION_GUIDE.md) — remaining live gates and human-narrated video checklist.
- [Six-phase plan](IMPLEMENTATION_PLAN.md), [detailed plans](docs/phases/), [handoff](PROJECT_HANDOFF.md), [memory](MEMORY.md), [progress](PROGRESS.md).
- [Operations](docs/operations.md), [CRE recovery](docs/phases/phase-5-runbook.md), [release checklist](docs/release-checklist.md), [demo script](docs/demo-script.md).
- [Product](PRODUCT.md), [design](DESIGN.md), [API contract](docs/phases/phase-3-api.md), [public schema](arkiv/schema.md).
- [License](LICENSE), [third-party attribution](THIRD_PARTY_NOTICES.md), [AI use](AI_USAGE.md), [Whitechain feedback](WHITECHAIN_FEEDBACK.md), [Chainlink feedback](CHAINLINK_FEEDBACK.md), [Arkiv criteria](arkiv/).

Selected tracks: [Whitechain · Operate](https://ethglobal.com/events/mumbai/prizes/whitechain), [Arkiv · Build from scratch](https://ethglobal.com/events/mumbai/prizes/arkiv), [Chainlink · Best workflow with CRE](https://ethglobal.com/events/mumbai/prizes/chainlink). Requirements map to implementation/evidence in the audit. Public hosting, customer funds, sponsor messages and submission need applicable user authorization. Work after the deadline is not a claim of timely entry or eligibility.
