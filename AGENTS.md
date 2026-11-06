# SettleKit agent instructions

Read `MEMORY.md`, `PROGRESS.md`, `PROJECT_HANDOFF.md` and `IMPLEMENTATION_PLAN.md` before planning or changing the project. These are persistent project memory for new chats. They contain the accepted scope, current status, sponsor tracks/docs, verified facts, implementation plan and evidence requirements. Current user instructions supersede older notes; keep these files consistent.

## Phase execution control

- The current implementation schedule is exactly Phases 1–6 in `IMPLEMENTATION_PLAN.md`; it replaces the handoff's former Phase 0–4 numbering.
- The user requested planning first. Do not start application implementation until instructed to start a phase. Complete the requested phase, verify and report it, then wait for the next phase instruction.
- The user authorized Phase 1 on 6 November 2026. Continue its implementation/verification and outstanding evidence gates; Phase 2 remains unauthorized. Test-wallet funding was explicitly deferred by the user, so preserve those live gates as pending while completing independent work.
- Confirmed preferences: Next.js with Neon PostgreSQL; wallet-signature merchant login; local app/worker development with public app hosting deferred; complete the full scope even if work continues beyond the event deadline. Neon replaces the earlier SQLite/libSQL recommendation.
- Check prerequisite gates before executing a phase. Continue independent work within the authorized phase if access is pending; never claim an unproven gate or phase complete.
- Before implementing each requested phase, write/review its detailed scope, dependencies, UX/states, security/data changes, sponsor requirements, test plan and exit checks in `docs/phases/phase-N.md`. Fix planning gaps, implement complete features, verify them and report evidence afterward; routine internal review does not require another approval round.
- Use relevant available design and browser-testing skills, starting with Impeccable for design context/quality. Preserve the premium handoff direction; establish durable product/design guidance and inspect actual desktop/tablet/mobile rendering. Fix visual, accessibility and interaction findings before declaring the affected UI complete.

## Preserve the accepted scope

- Whitechain Sepolia (`1874`) and its sponsor-specified USDT handle all customer payments and refunds.
- Refund the original payer on Whitechain in that same USDT. No crosschain refunds or bridges.
- Arkiv Rabdi provides real, user-visible queries of payment/refund records and an independent accountant view.
- Chainlink CRE reconciles payment evidence with the separate merchant API and recovers failed notifications. Its Whitechain HTTP/RPC route must be proven first; native CRE support has not been established.
- Keep merchant integration small: settlement wallet, API key, hosted checkout/helper, verified webhook. Merchant-facing flows must not expose infrastructure administration.
- Arc and ENS were explicitly rejected. Do not bring them back or replace a sponsor without a new user instruction.
- Wallet screening is mandatory before payment authorization, fulfillment/recovery and refunds. Hard matches, stale/unavailable required data and execution-time denials cannot silently pass. AI explanation remains optional.
- Build the fully working merchant dashboard and premium design specified in the handoff. Every visible action needs real persistence/API behavior, accurate data and complete UI states; keep external-site integration fast and small.
- Screening reduces defined risks; it does not guarantee lawful funds or prevent direct unsolicited token transfers. Never automatically forward/refund a flagged unsolicited transfer or claim our service freezes a merchant wallet.

## Implementation behavior

- Recheck the linked live sponsor requirements, SDK APIs, package compatibility, chain IDs and token metadata before building. Pin working versions and commit the lockfile.
- Follow the current ETHGlobal pages for the three selected tracks and linked official implementation docs. Maintain an evidence mapping from requirements to real implementation/checks/references; a backend provider choice does not add a prize sponsor.
- Use Neon PostgreSQL/Drizzle with server-only connection URLs, pooled runtime traffic and direct migrations/admin connections. Develop/test migrations on isolated branches; use exact monetary values and transactional outbox/job claims. Keep wallet-signature login and the other accepted components; do not introduce SQLite or unrelated Neon services as a substitute.
- Current planning is not proof of implementation. Clearly separate live testnet evidence, local tests, CRE simulation, deployed workflow execution, and mocks.
- Start with the handoff's feasibility checks, then build complete vertical flows. Continue independent work when a credential or sponsor clarification is pending.
- Keep real keys, cookies, API tokens and webhook secrets out of files committed to Git, browser bundles, screenshots and logs. Use test-only funded wallets and environment configuration.
- Use integer base units; verify chain, router, token, amount, payer, receiver, block evidence and invoice association before business actions.
- Persist payment transitions and outbox jobs atomically. Treat webhooks as at-least-once; enforce one fulfillment per logical payment through receiver-side idempotency.
- Reconciliation must use current risk/refund/order/confirmation state, ignore superseded events and cap recovery attempts. Do not fulfill refunded/cancelled/blocked orders from an old acceptance event.
- Arkiv is public. Keep PII, private invoice details and secrets off it. Trust configured writers and verify receipts against chain events.
- Keep steady Git history, third-party attribution, AI-use notes, sponsor feedback files and evidence while implementing.
- Test money handling, authorization, idempotency, failed-delivery recovery and real SDK integration. Render and inspect checkout/dashboard at desktop and mobile sizes.
- Use Windows-native shell/file operations and `rg` first. Read commands/installers before running them; use official docs and current CLI help.
- Update the handoff's status/evidence sections when work changes. Never invent addresses, transaction hashes, entity keys, workflow runs, merchant validation or prize eligibility.

## GitHub and checkpoint discipline

- User-authorized repository: `https://github.com/coderhormaz/SettleKit.git`. Preserve its existing history and files.
- Commit and push after each coherent, appropriately tested milestone: for example screening gate, tested router, checkout, receiver adapter, refunds, Arkiv, CRE recovery, or a completed dashboard flow. Do not accumulate the project into one end-of-hackathon commit/push.
- Review `git diff`, staged paths and secret exclusions before committing. Use specific messages and keep related status/evidence current. Prefer small reviewable commits; do not manufacture past timestamps/history or split broken changes just to increase commit count.
- Fetch/check remote changes before pushing. Use normal pushes to the authorized branch; never force-push or rewrite others' history. Respect branch protection and report any authentication/protection failure precisely.
- If push is temporarily blocked, preserve local commits, record the exact pending push in `PROGRESS.md`, continue independent work and retry when access is available. Never claim an unverified push succeeded.

The user explicitly authorized development commits and pushes to the repository above, including frequent milestone pushes during the future build. Production deployment, real customer funds and messages to sponsors require their own applicable user instructions; do not interpret GitHub authorization as those actions.
