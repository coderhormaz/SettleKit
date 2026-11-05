# SettleKit: six-phase implementation plan

Updated: 6 November 2026 (IST). Status: planning complete; all implementation phases are pending.

Read with [AGENTS.md](AGENTS.md), [MEMORY.md](MEMORY.md), [PROGRESS.md](PROGRESS.md) and [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md). The handoff retains the detailed product/security requirements; this document replaces its former Phase 0–4 numbering with exactly **Phases 1–6**. Current user instructions take precedence.

## Product and decisions

Build a stablecoin payment gateway that an existing business website can integrate through a small server adapter, REST API and hosted checkout. The merchant receives payment directly, operates a premium dashboard, issues screened refunds, checks independent accounting records and recovers missed order notifications.

The user confirmed these implementation preferences in this planning chat:

- Merchant login: wallet signature, with settlement-wallet ownership verification.
- Runtime: local first. Choose hosting later; no cloud account provisioning or paid services are required by this plan.
- Schedule: complete the entire six-phase scope even if work continues beyond the event deadline.
- Execution: wait for an instruction such as **“Start Phase 1.”** Complete the requested phase accurately, report its evidence and stop before the next phase. This planning request does not start application implementation.

Fixed product boundaries remain:

- Payments and refunds use Whitechain Sepolia, chain ID `1874`, and sponsor USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, with six decimals. Refunds return only to the original payer, in the original token and chain. See the [Whitechain track requirements](https://ethglobal.com/events/mumbai/prizes/whitechain).
- Arkiv Rabdi supplies actual public payment/refund records and a user-visible independent accountant query. Private operating data stays private. See the [Arkiv track requirements](https://ethglobal.com/events/mumbai/prizes/arkiv).
- Chainlink CRE compares Whitechain payment evidence with a separate merchant order API and initiates eligible notification recovery. Its HTTP/Whitechain route must be proven; native network support and prize eligibility are unverified. A successful real CLI simulation satisfies the track's execution requirement; it is distinct from deployed DON operation. See the [CRE track requirements](https://ethglobal.com/events/mumbai/prizes/chainlink).
- Screening is mandatory before authorization, fulfillment/recovery and refunds. Missing or stale required evidence cannot silently pass. AI remains optional.
- Direct settlement gives SettleKit no custody or ability to freeze merchant balances. Unsolicited transfers never satisfy an invoice or trigger automatic forwarding/refunds.
- Arc, ENS, bridges, crosschain refunds, swaps, yield, subscriptions, fiat conversion and a project token remain outside the accepted build.

The official event page still publishes **7 November 2026 at 09:00 IST** as the deadline. Work after it can complete the product, but cannot establish a timely submission. Record submission/eligibility only from actual evidence. See the [event guide](https://ethglobal.com/events/mumbai/info/details).

## Recommended technology stack

These are the recommended components for the confirmed local-first build. Exact package pins become final only after Phase 1's actual compatibility checks; registry metadata alone is insufficient.

| Layer | Choice | Reason and boundary |
| --- | --- | --- |
| Workspace/runtime | pnpm workspace, supported Node.js LTS, strict TypeScript | One repository and shared types. Start compatibility checks on the existing Node `22.14.0` / pnpm `11.25.0`; select supported compatible patches without an unnecessary global upgrade. |
| Dashboard, checkout and API | Next.js App Router + React; Route Handlers for REST | One application with shared authentication/domain services and a language-independent merchant API. Avoid a second general backend framework. |
| Interface | Tailwind CSS, selected Radix primitives, Lucide icons | Accessible components customized to the graphite/mint design; real tables, forms, dialogs and responsive detail views. Use Manrope and IBM Plex Mono with appropriate attribution. |
| Browser wallet/data | viem + wagmi + TanStack Query | Shared chain/ABI types and wallet state; injected EVM wallet first. WalletConnect is an optional later connector, not a prerequisite. |
| Merchant authentication | EIP-4361 wallet challenges through viem; durable server sessions | Single-use nonce, expected domain/URI/chain, expiry, verified signature and HttpOnly cookie. Settlement-wallet changes require fresh proof and screening. Use the maintained [viem verifier](https://viem.sh/docs/siwe/actions/verifySiweMessage). |
| Private storage | Drizzle ORM + local SQLite through `@libsql/client` | Durable local transactions without a database server/account. One documented local database file shared by gateway and worker; merchant demo store uses a separate database. [Drizzle SQLite support](https://orm.drizzle.team/docs/sqlite/get-started-sqlite). |
| Background processing | Persistent Node worker + transactional SQL outbox/jobs | Chain observer, webhook delivery, screening imports/policy synchronization and Arkiv sync. Persist cursors, leases and retry budgets; no request-lifetime timers. Start with a single worker and test cross-process database locking. |
| Contracts | Solidity + Hardhat 3/viem tooling + OpenZeppelin 5 | Minimal non-upgradeable router; EIP-712 authorization, SafeERC20 and reentrancy controls. Pin compiler/optimizer and explicitly target `prague` per [Whitechain deployment docs](https://docs.whitechain.io/build/deploy/deploy-with-hardhat). |
| Public accounting | Official `@arkiv-network/sdk`, Rabdi | Real receipt writes/queries, trusted writer filtering and source-chain verification. Independently served React accountant frontend; no gateway secret in its bundle. [Current network](https://docs.arkiv.network/). |
| Reconciliation | Official `@chainlink/cre-sdk` + CRE CLI; Bun for its build | Keep the workflow's Bun/WASM toolchain separate from the Node application. Use SDK HTTP capabilities, not ordinary Node networking. [HTTP capability](https://docs.chain.link/cre/capabilities/http), [Windows setup](https://docs.chain.link/cre/getting-started/cli-installation/windows). |
| Screening | Official-source importer + deterministic policy/source adapters | Current published wallet-address identifiers, explicit supported namespaces/freshness and internal hard denials. Optional commercial analytics requires separately verified access/coverage; no comprehensive tracing claim. [OFAC list service](https://ofac.treasury.gov/sanctions-list-service). |
| Validation/testing | Zod, Vitest, Hardhat's supported test runner, Playwright | Share input/money/event definitions. Test money, authorization, real SDK boundaries, durable recovery and browser flows. |
| Integration/delivery | REST, small JS adapter/helper, runnable Python example, GitHub Actions | Server-side authoritative prices, signed webhooks and authenticated order reads. Local reproducible startup and incremental verified Git checkpoints. |

Local SQLite is the chosen starting store, not an assumption about future cloud storage. Keep financial amounts as validated decimal base-unit strings/BigInt in code and lossless persisted values; never convert them to JavaScript floating point. Schema design must cover sums, limits and overflow explicitly.

Hosting remains deferred. A future choice must address worker lifetimes, shared durable storage, backups, secrets, HTTPS and costs. A move to PostgreSQL is a separate migration decision, not a drop-in URL change. Never deploy the local SQLite file to ephemeral serverless storage.

### Metadata checked during planning

Official registry metadata on 6 November 2026 returned these **candidates**. Nothing has been installed or build-tested in this chat.

| Group | Candidate versions |
| --- | --- |
| Application | Next `16.4.5`; React `19.3.1`; TypeScript `7.0.2`; Tailwind `4.3.4`; Zod `4.6.7` |
| Wallet/data | viem `2.57.16`; wagmi `3.7.11`; TanStack Query `5.106.1` |
| Private storage | Drizzle `0.45.4`; `@libsql/client` `0.18.0` |
| Contract tooling | Hardhat `3.21.2`; viem toolbox `5.0.7`; OpenZeppelin `5.6.1`; solc `0.8.38` |
| Sponsor SDKs | Arkiv `1.0.1`; CRE SDK `1.23.0` (declares Bun `>=1.2.21`) |
| Checks | Vitest `5.1.0`; Playwright `1.64.1` |

Sources: npm's official per-package `/latest` metadata, including [Next](https://registry.npmjs.org/next/latest), [wagmi](https://registry.npmjs.org/wagmi/latest), [Arkiv](https://registry.npmjs.org/@arkiv-network%2fsdk/latest), [CRE](https://registry.npmjs.org/@chainlink%2fcre-sdk/latest), [Hardhat](https://registry.npmjs.org/hardhat/latest) and [libSQL](https://registry.npmjs.org/@libsql%2fclient/latest). Phase 1 must check full transitive/peer support, especially TypeScript's major version, the Hardhat plugins and the CRE build. Choose a compatible stable version if a candidate fails; record the reason and commit the lockfile.

Read-only RPC checks in this chat returned Whitechain `0x752`, Rabdi `0x76edaf`, and USDT decimals `0x...06`. These establish network identifiers/metadata only. Test wallets, approvals/transfers, entity writes and workflow execution remain unproven.

## Architecture and domain boundaries

```mermaid
flowchart LR
  Store[Separate merchant store] --> API[Next.js API and private services]
  API --> Checkout[Hosted checkout]
  Checkout --> Risk[Screening and signed authorization]
  Risk --> Router[Whitechain router: USDT]
  Router --> Worker[Durable observer and worker]
  Worker <--> DB[(Private SQLite and outbox)]
  API <--> DB
  Worker --> Hook[Signed webhook]
  Hook --> Store
  Worker --> Arkiv[Public Arkiv receipts]
  Arkiv --> Accountant[Independent accountant]
  Router --> Accountant
  CRE[Real CRE workflow] --> Router
  CRE --> OrderAPI[Merchant order-state API]
  OrderAPI --> Store
  CRE --> Recover[Authenticated recovery API]
  Recover --> DB
```

The CRE chain connection is the proposed HTTP/RPC route pending Phase 1 proof. Payments/refunds stay on Whitechain; Arkiv writes are public data publication, not settlement.

Keep distinct facts for payment settlement, canonical confirmation stage, screening eligibility, refund totals, webhook delivery, merchant fulfillment and Arkiv synchronization. A paid order can have failed delivery or be in review; these are not equivalent to unpaid. Every eligibility-affecting transition advances a monotonic state version.

Private entities include merchants/wallets, login challenges/sessions, API-key hashes, encrypted webhook credentials, contacts, links, invoices, checkout sessions/authorizations, source snapshots/decisions/reviews, canonical events, refund intents, idempotency records, outbox jobs, cursors and audit entries. Public Arkiv records contain only minimal settlement evidence and opaque references; no private order numbers, email, keys or risk dossiers.

Suggested source layout follows handoff section 14: `apps/gateway`, `apps/accountant`, `examples/store`, `examples/python`, and shared `packages/contracts`, `packages/shared`, `packages/arkiv`, `packages/cre`, `packages/worker`. Add a shared private database/domain package only where it reduces duplication. Layout is an implementation choice, not another sponsor requirement.

## The six phases

| Phase | Deliverable | Depends on | Current status |
| --- | --- | --- | --- |
| 1 | Proven tools/sponsor access, private foundation, wallet onboarding and design system | User says start; test access as needed | Not started |
| 2 | Screened live payment, hosted checkout and one idempotent store fulfillment | Phase 1 payment/security gates | Not started |
| 3 | Complete merchant operating dashboard and integration controls | Phase 2 verified lifecycle | Not started |
| 4 | Working refunds, Arkiv receipts and independent accounting | Phase 2 router; Phase 3 merchant controls | Not started |
| 5 | Real CRE reconciliation and safe failed-notification recovery | Phase 1 CRE proof; Phases 2–4 current-state rules | Not started |
| 6 | Full-system verification, reproducible release and evidence/demo materials | All earlier exit gates | Not started |

### Phase 1 — Foundation and feasibility

**Outcome:** a runnable local foundation with proven integration routes, secure merchant identity and a documented build baseline.

Build in this order:

1. Re-read memory/Git state and current official sponsor/tooling docs. Inspect any starter/license before reuse. Create the pnpm workspace and placeholder-only `.env.example`; select compatible stable versions through real install/import/build checks and record them in `docs/versions.md` and the lockfile. Inspect official Windows installers and verify downloads before running them.
2. Establish local SQLite migrations, shared configuration/validation/money types, structured redacted logs, private-secret storage and a test database. Prove atomic domain-transition/outbox writes, worker job leases, restart behavior and gateway/worker locking with the selected driver. Avoid introducing two inconsistent money representations.
3. Implement wallet login, single-use challenges, durable sessions/logout, origin/CSRF protection, tenant-bound API access and settlement-wallet ownership proof. Create onboarding/profile persistence and a second merchant fixture for isolation tests. Buyers need only a connected wallet for ordinary checkout.
4. Implement current official-source import and private screening decisions. Record namespace coverage, source URL/version/hash, fetch time, successful parse, health/freshness and reason codes. Test allow/no-match, synthetic hard match, stale, malformed and unavailable cases. Define policy/quote expiry, synchronization failures and protected operator roles; merchant controls cannot disable the gate.
5. Recheck Whitechain chain/token behavior and funding paths. Prepare separate test payer, merchant, deployer and protected platform signer/policy roles. Establish test WBT and the specified USDT, and inspect approval/transfer behavior without assuming permit support. No private keys in chat, Git, browser bundles or evidence.
6. Use an actual funded Arkiv writer to create/query one innocuous real Rabdi entity. Save its writer, entity key and query. Confirm independent-browser read/CORS behavior without a private browser credential.
7. Set up official CRE CLI/Bun/account access. Run a minimal **real CRE CLI simulation** that calls Whitechain JSON-RPC for real chain data and a separate local diagnostic merchant API. Save sanitized command/output. This proves the route only; payment verification and recovery are Phase 5. Check localhost reachability in actual simulation and current capability limits. Record any unresolved sponsor interpretation without claiming acceptance.
8. Build the graphite/mint tokens, typography, accessible app shell and reusable table/form/dialog/status components. Show only working onboarding navigation. Establish desktop/mobile patterns before dashboard features expand. Add basic CI for the runnable foundation.

**Exit checks:** clean install/build/typecheck; source/freshness failure tests pass; nonce replay/domain/expiry and cross-tenant tests pass; database/worker restart checks pass; real Arkiv round-trip and CRE HTTP/RPC simulation have separate evidence. Missing credentials leave the affected gate explicitly open; independent work can continue.

**Checkpoint(s):** compatible workspace/private foundation; wallet onboarding/screening baseline; separate sponsor feasibility proof. Commit/push coherent verified milestones rather than waiting for every external account gate.

### Phase 2 — Screened Whitechain payment and merchant fulfillment

**Outcome:** a buyer pays the specified test USDT, and exactly one eligible external-store order is fulfilled.

1. Implement the minimal non-upgradeable router **with both payment and full/partial refund primitives before its first deployment**. Later Phase 4 adds refund services/UI; it does not require upgrading this router. Bind EIP-712 authorizations to operation, chain/router, invoice/refund ID, payer, merchant, token, exact amount, evidence commitment, epoch and expiry. Enforce signer roles, hard denials/pause/epoch, uniqueness, SafeERC20 transfers and reentrancy protection. Refund execution requires the original merchant and original-payer destination, plus fresh refund-specific authorization and cumulative caps.
2. Test signature tampering/replay, expired/wrong-domain approvals, token/payer/recipient substitution, bypass attempts, stale policy, transfer failure/retry, refund authority/over-refunds and rounding boundaries. Protect policy administration separately from merchant sessions; fail closed when required policy synchronization cannot be confirmed. Deploy/verify on Whitechain only when the tested prerequisites and test funding are available; save deployment/compiler/constructor evidence.
3. Implement tenant-authenticated, idempotent checkout-session creation and payer-bound screening authorization. Use authoritative server prices and unguessable public session references. Validate callback/return domains and reject SSRF targets/unsafe redirects.
4. Build hosted checkout/status: wallet connection, network switching, USDT amount/payee, required allowance and WBT gas, authorization, submission, pending/accepted/rejected/expired/reload states. Approval is for the needed amount. Browser return never marks an order paid.
5. Build durable bounded log polling with cursors/overlap, canonical receipt/event verification and the configured acceptance stage. Verify chain/router/token/amount/payer/merchant/invoice/block association. Atomically persist state and delivery jobs; handle duplicate logs/restarts and corrective reorg states.
6. Build HMAC-signed raw-body webhooks with stable event IDs, monotonic state versions, timeouts, retry budgets/backoff and dead-letter state. Rescreen eligibility before a new fulfillment. Expose basic real payment/detail/delivery/risk views needed to operate this flow.
7. Ship a separate small store with its own durable orders and the reusable receiver/order-read adapter. Verify signature/timestamp, atomically deduplicate and fulfill by logical order/payment association, check current eligibility/refund/order versions, and provide authenticated minimal order reads. An old accepted event cannot override current cancellation/review/refund state. Use an actual 25 USDT checkout for testnet evidence.

**Exit checks:** source-verified router and actual sponsor-USDT payment evidence; one store fulfillment despite webhook/log replay and restarts; rejected direct router bypass; no authorization for blocked/stale/unavailable required data; forged/stale callbacks and cross-tenant access fail. Confirmation labels match the actual stage, with tested reorg corrections.

**Checkpoint(s):** tested router; verified testnet deployment; checkout/observer; signed adapter and real end-to-end payment. Each includes related tests/evidence.

### Phase 3 — Complete merchant operations dashboard

**Outcome:** merchants can operate their business through working persisted screens and a small integration.

Implement each group as a complete API → persistence → authorization → UI → verification slice:

| Feature group | Required working behavior |
| --- | --- |
| Overview/payments | Date-filtered gross/refunded/net, counts and event-derived chart; search, filters, sorting/pagination; detailed timeline, confirmation/risk/delivery states and explorer links. Never present direct settlement as a custodial payout balance. |
| Payment links | Create fixed-amount titled/expiring links, copy/open/list/deactivate. Deactivation blocks new sessions/authorizations; disclose outstanding signed-authorization validity unless actually revoked onchain. |
| Invoices/contacts | Create invoices with optional private contact/due date/notes and hosted link; accurate unpaid/overdue/paid/refunded states; eligible void and printable invoice. Add/edit/archive contacts and show related history privately. |
| Developer setup | Generate scoped API keys, reveal once, hash for lookup, rotate/revoke, generate correct REST/JS snippets and test the current configuration. Show the actual setup steps including webhook and order reads. |
| Webhooks | Approved endpoint configuration, encrypted per-merchant secrets, rotation, labeled test events, delivery history/errors, and eligible bounded authenticated replay. Endpoint edits/keys are audited. |
| Risk/settings/audit | Real source/check age/coverage and review cases, refresh/notes/evidence-based resolution; profile/domains/security/session/pause settings; fresh proof/screening for wallet change and preserved historical refunds. Hard denials have no merchant override. |
| Reports | Accurate filtered local CSV, documented range and formula-safe text fields. Phase 4 adds the independent accountant link and verified public coverage. |

Apply the premium graphite/mint design throughout, with readable tabular USDT amounts, coherent spacing and keyboard focus. Every visible action needs loading, empty, validation/error, pending and success states. Refund/accountant/CRE controls appear as their backing phases finish; no clickable placeholders.

**Exit checks:** exercise create/edit/archive/deactivate/void/revoke/rotate/export/test/replay actions and verify persisted results after reload. Test two-merchant isolation across every resource family. Inspect 390×844, 768×1024 and 1440×900 plus keyboard operation. Count all external integration glue honestly; measure setup steps/time without promising an untested universal target.

**Checkpoint(s):** links/invoices/contacts; developer/webhook configuration; reports/settings/risk/audit and completed dashboard inspection. Keep each functional slice reviewable.

### Phase 4 — Refunds and independently verifiable accounting

**Outcome:** a real 25 USDT payment can receive a 5 USDT merchant-authorized refund; verified reports show 25 gross, 5 refunded and 20 net.

1. Add idempotent refund intents and fresh payer/merchant screening. Persist a nonterminal refund intent, advance the eligibility version and hold new fulfillment/recovery in one private transaction **before** issuing its executable payload. Obtain the original merchant's wallet authorization, check balance/allowance, and submit against Phase 2's router. Enforce original payer/token/chain and remaining amount. A failed/expired/cancelled intent releases its hold only after authoritative state and outstanding authorization validity are rechecked. API/CRE/support cannot sign merchant-funded refunds on the merchant's behalf.
2. Complete refund list/detail/dialog with remaining refundable amount, current reasons/coverage, approval/signature, pending/confirmed/reverted/review states and audit trail. Only canonical chain events change refunded totals. Concurrent/refunded/duplicate requests must not over-refund; a new hard denial holds execution for review.
3. Add versioned refund/corrective notifications and receiver state handling. Fully refunded/cancelled/blocked orders never gain new fulfillment from an old acceptance. Partial refunds pause automatic new fulfillment by default. Preserve the separate settled-payment fact.
4. Implement actual Arkiv payment/refund writes via durable sync jobs. Define indexed fields, trusted writer/ownership, event deduplication, expiry/renewal and retry behavior. Recover a crash between a successful entity write and private mapping persistence. Publish only minimal licensed public evidence.
5. Build the separately served accountant: real merchant/kind/date/block filters, pagination, source-chain receipt verification, trusted-writer filtering, event deduplication, correct sums, explorer/entity links and CSV.
6. Reconcile a stated deployment-to-head block range against Whitechain router payment/refund events. Display progress/missing/expired records and incomplete coverage honestly; verified available records do not establish complete history. Show the viewer reading public history while the gateway API is stopped, and report any actual public-RPC limitation.

**Exit checks:** actual original-payer refund explorer evidence; replay/concurrency/cap/denial tests pass; pending-refund versus webhook/recovery race tests enforce the hold, with already-in-progress cross-system conflicts recorded for review; live Rabdi receipt keys/query; correct 25/5/20 dashboard/accountant/CSV results; expiry/missing/forged-writer records handled; independent viewer works without the gateway history API.

**Checkpoint(s):** refund API/UI and real refund; reliable Arkiv projection; independent accountant/coverage reconciliation. Preserve real entity keys/queries with no private payloads.

### Phase 5 — Chainlink CRE reconciliation and recovery

**Outcome:** an actual CRE run identifies a verified paid-but-unfulfilled order and safely initiates its notification recovery.

1. Expand Phase 1's proven workflow using the current CRE SDK/runtime, explicit configuration and service-authenticated paginated candidate API. Read actual router receipt/block/event data through the proven route, separate store order state and the latest gateway risk/refund/confirmation/version facts. Normalize consensus inputs and stable block evidence as required by the SDK.
2. Match chain/router/token/amount/payer/merchant/invoice/order association and current versions. Emit a stable recovery intent only when the payment is accepted, screening fresh/allowed, order pending and delivery failure recoverable.
3. Backend recovery authentication/evidence checks must revalidate current eligibility atomically and schedule the existing logical event, with a stable recovery key, cooldown and capped budget. The normal webhook signer delivers it. CRE never charges again or authorizes a refund.
4. Enforce the complete matrix: fulfilled → acknowledgment/audit only; nonterminal refund intent → hold; refunded/cancelled/orphaned/unconfirmed/blocked → no new fulfillment; partial refund → review; absent/mismatched/stale association → refuse/review; permanent endpoint/auth failure → require repair/revalidation. Normal informational corrections/refund notifications still preserve history.
5. Add an explicit development-only failure injector. Fail initial notification, reach a labeled stale/dead-letter state, restore the receiver, run CRE, then show delivery and exactly one business fulfillment. Record CRE as the initiating actor so an unrelated timer cannot be credited with the result.
6. Test repeated workflow runs, stale candidates, concurrent refund/cancellation/risk changes, endpoint outages and exhausted budgets. Show real dashboard recovery outcome/time while keeping CRE administration out of merchant onboarding.

**Exit checks:** real CLI simulation using actual Whitechain payment and separate order API, authenticated recovery and before/after order evidence; duplicate execution causes no duplicate charge/fulfillment/totals; unsafe matrix cases are no-ops/refusals; sanitized source/config/command/output preserved. Call it deployed workflow execution only if a deployment actually ran and was verified.

**Checkpoint(s):** real evidence-reading workflow; verified recovery integration; replay/current-state matrix and demo evidence. If CRE access/route fails, record the exact blocker and continue independent work; ordinary Node recovery is not a completed CRE integration.

### Phase 6 — End-to-end hardening, reproducible release and evidence

**Outcome:** the complete local product can be installed, demonstrated and independently reviewed from its repository and evidence.

1. Run a clean-install/build/typecheck/CI pass and the relevant money/auth/isolation/idempotency suites. Exercise the complete path: wallet onboarding → store checkout → screening → specified-USDT payment → normal or CRE delivery → merchant refund → Arkiv accounting/export. Repeat the failure paths changed by later phases.
2. Verify amount limits, partial/full refund races, nonce/quote/idempotency conflicts, observer rollback/restart, interrupted jobs, source outages/staleness, policy-sync failure, signing-key/credential rotation, SSRF/redirect defenses and bounded endpoint/RPC behavior. Verify local database backup/restore and log redaction. Use synthetic risk fixtures; do not transact with a real flagged counterparty.
3. Inspect all four surfaces—dashboard, checkout/status, separate store and accountant—at mobile/tablet/desktop sizes, keyboard-only and reduced-motion settings. Resolve overflow, wallet/modal errors, confusing labels, inaccurate totals and inaccessible actions. Keep every visible control backed by real behavior.
4. Finish the runnable JS/REST/Python integrations, local startup scripts, environment/role explanations, API and architecture docs, complete line/setup-time measurements and real developer feedback when available. Do not invent merchant validation.
5. Complete `LICENSE`, third-party attribution, `AI_USAGE.md`, `WHITECHAIN_FEEDBACK.md`, `CHAINLINK_FEEDBACK.md` and the Arkiv criterion/schema files using actual results. Build an evidence index separating local tests, live testnet calls, real SDK writes, CRE simulation, deployed execution and mocks. Include actual contract/transaction/entity/query/run references where obtained.
6. Prepare a 2–4 minute demonstration with user/team human narration and screenshots: screened checkout, 25 USDT payment, failed notification and real CRE recovery, 5 USDT refund, independent 25/5/20 accounting. Prepare the script/recording assets, and obtain the human narration rather than substituting an AI voice. Missing narration keeps video evidence pending. Record limitations and remaining blockers plainly. Actual publication/submission is a user action unless separately instructed; do not claim event eligibility or completion after its deadline.
7. Prepare portable release/startup configuration. Hosting remains an explicit later decision: local completion does not require cloud spending or publication. When requested later, choose durable storage/processes and approved domains, prepare the concrete deployment, and obtain any required final authorization before publishing.

**Exit checks:** all prior phase gates have evidence; clean setup is reproducible; end-to-end flows and inspection pass; sponsor material is complete where its integration actually works; final Git checkpoint is pushed and remotely verified. Remaining external blockers keep their affected feature/phase incomplete. “Complete” here means the agreed testnet/local product, not authorization for production customer funds.

**Checkpoint(s):** final functional/security fixes; verified release/examples; evidence/demo/documentation. Keep fixes with their checks rather than creating one large final code upload.

## Cross-phase defaults and completion rules

- Every phase includes the UI and meaningful tests for what it adds. Security, design and evidence are ongoing work; Phase 6 checks the integrated result.
- Suggested screening defaults to validate in Phase 1: hourly source refresh, explicitly configured maximum successful-fetch age, party cache at most two minutes, and roughly 60-second executable authorizations bounded by evidence expiry. Publish actual settings and denial-synchronization latency; these are engineering policies, not legal guarantees.
- A required provider being unknown/stale/unavailable prevents authorization. Optional commercial analytics stays visibly unsupported until actual coverage/access is established. Do not claim lawful/clean funds or comprehensive source-of-funds tracing.
- Protect policy/signing roles from merchant access. Use minimal test allowances, no logged keys, one-time secret reveal, encrypted recoverable credentials, redacted errors and test-only funded wallets.
- Atomically persist private transitions plus outbox jobs. Webhook transport is at least once; receiver transactions and logical payment/order uniqueness produce one business fulfillment. Do not claim cross-system atomicity.
- Payment-link deactivation and invoice voiding cannot erase an already executed payment; handle in-flight authorizations and late discovery explicitly. Invoice expiry never erases real chain evidence.
- Reorg, refund, risk and cancellation transitions supersede old acceptance events. Preserve history and review conflicts; fulfilled digital goods cannot be automatically undelivered.
- Commit/push after each coherent verified milestone to the authorized repository, fetch/check remote changes, inspect explicit staged paths and secrets, and verify the resulting remote hash. Never force-push. If blocked, keep the local commit and record the precise pending push in `PROGRESS.md`.

For each requested phase, the completion report must name what works, changed paths, checks actually run, live evidence, exact open blockers, Git/remote verification and the next phase's prerequisites. Update all persistent project documents when decisions/status change. Do not start Phase N+1 until the user instructs it.

## Inputs needed during implementation

No further product decision is required to start Phase 1. The user has already answered login, hosting and schedule questions. Local-first means the applications run locally; live sponsor proofs still need internet/testnet access. Account/faucet steps may be needed at the relevant gate:

| Input | Needed for | Handling |
| --- | --- | --- |
| Throwaway test wallets, WBT and exact sponsor USDT | Live Whitechain payment/refund | Use local ignored configuration/user wallet; never paste private keys into chat. Do not substitute a self-minted token. |
| Arkiv Hub faucet/access if required | Actual funded Rabdi writes and reproducible reads | User completes account actions where necessary; private credentials stay server-side. |
| Chainlink account/CLI login if required | Real CRE simulation | User completes interactive login; inspect actual CLI help. Live DON deployment access is not required for the agreed simulation evidence. |
| User/team human narration and substantive review/contribution | Final demo and truthful AI-use disclosure | Prepare script/recording assets; human narration must actually be supplied before marking the video complete. |
| Hosting/domain/budget | Later public deployment only | Deferred by the user's choice. No dependency on a paid account for local completion. |
| Commercial analytics credentials and coverage | Optional deeper checks only | Default to the documented official-address-list baseline. If policy is changed to require a provider, no allow result without it. |

If a credential blocks one gate, continue independent work in the authorized phase and preserve the exact blocker. Do not call the phase complete or replace a selected sponsor to conceal the gap.

## Starting a phase

Say **“Start Phase 1”**, then **“Start Phase 2”**, and so on. Before changes, inspect current files, memory and Git state; revalidate the requested phase's prerequisites and relevant current docs. Implement only the requested phase and its necessary in-scope fixes, verify it, update memory/evidence, commit/push coherent milestones and report the result. If an earlier required gate is missing, explain it and progress independent tasks without pretending the dependency passed.

The next authorized action after this planning checkpoint is to wait for the user's phase-start instruction.
