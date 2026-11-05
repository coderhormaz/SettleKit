# SettleKit

Screened USDT checkout on Whitechain, same-chain refunds, a premium merchant dashboard, independently verifiable accounting records, and recovery of missed payment notifications.

**Status:** specification and handoff prepared; implementation has not started. No live gateway, deployed contract or payment-processing claim is made by this README.

## Start here

- [Project handoff and implementation plan](PROJECT_HANDOFF.md): product decisions, sponsor requirements/resources, current technology candidates, architecture, security, dashboard inventory, tests and demo.
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

The full handoff includes a ready-to-paste prompt for the next implementation chat.
