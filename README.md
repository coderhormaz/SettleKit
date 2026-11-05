# SettleKit

Screened USDT checkout on Whitechain, same-chain refunds, a premium merchant dashboard, independently verifiable accounting records, and recovery of missed payment notifications.

**Status:** specification and six-phase build plan prepared; all implementation phases are pending. Implementation starts only when the user instructs a phase. No live gateway, deployed contract or payment-processing claim is made by this README.

## Start here

- [Six-phase implementation plan](IMPLEMENTATION_PLAN.md): selected Next.js + Neon PostgreSQL stack, ordered work, prerequisites, exit checks and checkpoints. Wallet-signature login; local app/worker development; public app hosting deferred.
- [Detailed project handoff](PROJECT_HANDOFF.md): product decisions, sponsor requirements/resources, current technology candidates, architecture, security, dashboard inventory, tests and demo.
- [Persistent project memory](MEMORY.md): accepted decisions and user preferences for new chats.
- [Current progress](PROGRESS.md): completed work, unverified gates and next actions.
- [Agent instructions](AGENTS.md): scope and build/checkpoint rules.

## Agreed sponsor integrations

| Sponsor | Track | Role |
| --- | --- | --- |
| Whitechain | [Operate · Stablecoin Payments for Business](https://ethglobal.com/events/mumbai/prizes/whitechain) | USDT payments and full/partial refunds on Whitechain Sepolia |
| Arkiv | [Build on Arkiv (from scratch)](https://ethglobal.com/events/mumbai/prizes/arkiv) | Queryable receipts, independent accounting and exports |
| Chainlink | [Best workflow with CRE](https://ethglobal.com/events/mumbai/prizes/chainlink) | Compare blockchain and store state; recover eligible failed notifications |

The proposed CRE HTTP/Whitechain-RPC route must be proven; native support and prize eligibility are not claimed as verified. Arc and ENS are excluded from the accepted MVP.

## Product requirements

- Minimal website integration through REST, hosted checkout and a small merchant webhook/order-state adapter.
- Mandatory wallet screening with named sources, explicit freshness/coverage and execution-time authorization controls.
- Merchant-authorized refunds in the original USDT on Whitechain to the original payer.
- Working, isolated merchant dashboards for payments, links, invoices, customers, refunds, risk cases, keys, webhooks, reports and settings.
- Accurate data, complete UI states and premium responsive design.
- Idempotent fulfillment, durable delivery state and evidence-backed recovery.

Screening enforces configured checks; it cannot guarantee all funds are lawful or prevent direct unsolicited transfers to public wallets. Production use needs verified data-provider coverage and the applicable legal/compliance process. The hackathon build uses test tokens.

## Development checkpoints

Preserve existing history and push each coherent, appropriately tested milestone to this repository throughout the build. Do not accumulate the entire project into a single final commit. Keep project memory, validation results and real evidence current. Never commit secrets or fabricate progress.

For every requested phase: prepare/review the detailed plan and relevant sponsor docs, use the available design skills, implement complete features, test real persistence/integrations, inspect responsive UI, fix findings, then report verified results. The database choice is Neon PostgreSQL; the app and worker initially run locally. No database or application implementation is claimed yet.

Read the plan, then say **“Start Phase 1”** to begin. Each later phase starts on its own instruction. The full handoff includes a prompt for an implementation chat.
