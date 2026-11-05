# SettleKit: persistent project memory

Updated: 6 November 2026 (IST). Repository: [coderhormaz/SettleKit](https://github.com/coderhormaz/SettleKit/).

Read this file, `PROGRESS.md`, `AGENTS.md`, `PROJECT_HANDOFF.md` and `IMPLEMENTATION_PLAN.md` at the start of each implementation chat. This is repository-owned memory, not a claim that a separate app-wide memory service was updated. Latest user instructions take precedence; keep these documents consistent.

## Accepted user intent

Build an easy-to-integrate stablecoin payment gateway with a premium, fully functional merchant dashboard. The user approved **Whitechain + Arkiv + Chainlink** and then explicitly required security screening, same-chain refunds, polished UI/UX and frequent GitHub checkpoints. The latest deliverable is a complete six-phase implementation plan and technology recommendation. **Do not start application implementation until the user says to start a phase.** Complete and report that phase, then wait for the next phase instruction.

## Latest planning decisions

- The execution plan is `IMPLEMENTATION_PLAN.md`, Phases **1–6**: foundation/feasibility; screened payment/store fulfillment; complete merchant operations dashboard; refunds/Arkiv/accounting; CRE recovery; final verification/release/evidence. This replaces the old Phase 0–4 numbering.
- Merchant authentication: wallet-signature login with ownership proof and durable secure sessions.
- Run locally first. Use private SQLite/Drizzle with persistent Node gateway/worker processes; hosting and any cloud migration are later decisions. No cloud provisioning or paid service is required for local completion.
- Complete all six phases even beyond the published event deadline; do not imply late work constitutes a timely entry.
- Exact dependency pins remain untested until Phase 1. The non-upgradeable router must include tested payment and refund primitives before its initial deployment; Phase 4 adds the refund service/UI and live refund evidence.
- Current stage remains planning only. The next action is to wait for **“Start Phase 1”**, then execute its prerequisite checks and foundation work.

## Non-negotiable product decisions

- All customer payments and refunds: **Whitechain Sepolia, chain ID 1874**, sponsor USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, six decimals.
- Refunds: full/partial, merchant-authorized, same original USDT and chain, original payer only, bounded by remaining amount, idempotent. Fresh screening is also required; a new hard match pauses refund execution for review.
- Whitechain track: **Operate · Stablecoin Payments for Business**.
- Arkiv track: **Build on Arkiv (from scratch)**. Actual Rabdi writes and user-visible queries; independent accountant page, correct totals/export and explicit history coverage.
- Chainlink track: **Best workflow with CRE**. Actual workflow compares Whitechain payment evidence with an external merchant order API and recovers eligible failed notifications. A real CLI simulation is permitted; native CRE support for Whitechain and the proposed HTTP/RPC route remain unproven until tested.
- **Arc and ENS are rejected.** No bridge, crosschain refund, extra settlement network, required ENS name or merchant-facing infrastructure configuration.
- AI is optional. Wallet screening is **mandatory**, not optional.

## Ease of use

Merchant journey: establish an account/settlement wallet, obtain generated API configuration, add a small checkout/webhook/order-state adapter, and operate the dashboard. No-code payment links are available for simple collection. Use hosted checkout/redirect, a small JS helper and language-independent REST; provide a Python example. Measure the complete integration, including order-state reading, not just a pay-button snippet.

Infrastructure credentials, CRE, Arkiv writes, denylist synchronization and provider setup belong to the platform operator. Buyer screening occurs automatically using the actual connected wallet. Baseline buyer transactions may require WBT gas and token approval; do not pretend they are gasless.

## Mandatory security boundaries

- Screen payer and merchant before payment authorization; recheck current eligibility before fulfillment/recovery and refund authorization.
- Use named, current sources and explicit coverage/freshness policies. Known hard matches block. Required data that is unknown/stale/unavailable cannot silently pass.
- Bind authorization to payer, recipient, invoice, amount/token, operation, chain/router, policy epoch, evidence commitment and short expiry. Router checks current hard-denial/pause/epoch controls; a UI-only warning is insufficient.
- Keep screening decisions, provider responses and review notes private; publish minimal licensed settlement evidence to Arkiv.
- “Passed configured checks” is a time-scoped result, not a guarantee of lawful money or legal compliance. List matching is not source-of-funds tracing. Production analytics coverage and jurisdiction-specific obligations need separate verification.
- Public wallets can receive unsolicited ERC-20 transfers. Such transfers never satisfy our invoices or trigger automatic forwarding/refunds.
- Settled money is held by the merchant, not the gateway. A later flag holds further business actions; do not claim the gateway freezes the wallet or automatically returns blocked property.
- The old Chainalysis Sanctions Oracle is deprecated according to its current official documentation. Use maintained sources/providers and verify coverage; do not copy stale oracle examples.
- Reconcile current screening, confirmation, refund and order states. Never fulfill a fully refunded/cancelled/blocked order from an old acceptance event. Partial refunds default to review before any new fulfillment.
- A nonterminal refund intent immediately advances eligibility state and holds new fulfillment/recovery before an executable refund payload is issued. Releasing the hold requires current chain/authorization revalidation; record already-in-progress cross-system conflicts for review.
- Webhooks are at-least-once; business fulfillment is idempotent by payment/order association. Apply state versions, retry budgets and corrective events for reorgs.

## Dashboard and design requirements

Build working onboarding, overview, payments/details, payment links, invoices, private customer contacts, refunds, risk/review queue, API keys/integration examples, webhook configuration/deliveries, reports/CSV, settings and audit history. Each merchant is isolated. Every displayed control must persist and perform its action with correct loading, empty, error and success states. Omit unfinished features from navigation.

Premium direction: refined graphite/mint crypto-fintech dashboard, strong readable typography and tabular amounts, compact useful tables, restrained motion, cohesive spacing and responsive detail views. Hosted checkout can use a coordinated light surface. Keep finance information truthful and clear; no fake balances or unrelated token-market decoration. Verify mobile/tablet/desktop and keyboard behavior. Exact inventory and visual tokens are in handoff section 8.

## Engineering and evidence

Use current compatible stable releases, pinned after compatibility checks. Handoff section 7 and the implementation plan record researched candidates; these are not installed/tested versions. Planning rechecked Node `22.14.0` and pnpm `11.25.0`; Bun, CRE, Docker and psql were not found on PATH. No tool was installed in this planning chat.

Prefer a small Next/React/TypeScript app, viem/wagmi, Hardhat/OpenZeppelin, the official Arkiv SDK and real CRE SDK. Use private durable transactional state alongside public Arkiv projection; keep workers persistent. Do not put local SQLite on ephemeral serverless disk. Preserve source attribution, meaningful tests and real deployment/entity/workflow evidence.

Read the authoritative sponsor rules and links in `PROJECT_HANDOFF.md`. Required documentation includes `WHITECHAIN_FEEDBACK.md`, the `/arkiv/` criterion files, open-source licensing, AI-use disclosure and a narrated 2–4 minute video. Published deadline was **7 November 2026 at 09:00 IST**; recheck current context rather than assuming a future deadline.

## GitHub checkpoint instruction from the user

Push to **https://github.com/coderhormaz/SettleKit.git**. Preserve upstream history. Commit and push after each coherent, appropriately tested milestone throughout the build; do not leave the entire project for one large final commit. Keep the milestone's progress/evidence current, review staged files for secrets, fetch before pushing and never force-push. Do not manufacture historical progress.

If authentication or protection blocks a push, keep the local commit, record the exact blocker/pending hash, report it and continue independent work. A push is complete only after remote verification. Follow `PROGRESS.md` for the actual latest checkpoint and next action.
