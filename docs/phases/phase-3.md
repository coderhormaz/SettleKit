# Phase 3 — merchant operations

Authorized6November2026; all six phases were subsequently authorized. The final114-test root/16-test browser runs, real Neon operations and complete local link/invoice flow pass. Contact invoice/payment history, overview follow-up and source-time disclosures are complete. Main agent only; funded live proofs remain open.

## Architecture and review

Extend the existing Next route→private domain→Neon transaction→outbox pattern. Alternatives reviewed: generic JSON CRUD hides monetary/state constraints; a second backend duplicates authentication; a typed SQL service per bounded resource preserves tenant/version/audit invariants with the smallest stack. Choose typed Drizzle schema plus parameterized services and shared validation. Money remains integer base units. Merchant cookie identity always supplies tenant; request bodies never select it.

The dashboard is an ordinary extension of DESIGN.md's graphite/mint Operate world: persistent navigation, date/search/filter toolbar, readable compact tables and responsive details/forms. Forms must name their task rather than expose infrastructure. Empty states provide real create actions. Preserve existing setup/checkout/store worlds. Do not add CRE controls before Phase 5.

## File plan and task order

FILES TO CREATE: `packages/db/src/operations.ts` (typed contacts/links/invoices/keys/settings/review/report services), typed schema/migrations and isolated integration tests; `packages/core/src/operations.ts` (browser-safe schemas/CSV helpers); `apps/gateway/app/dashboard/` and route-local responsive components/styles; public link/invoice pages; REST/JS/Python runnable integration examples; dashboard surface brief and evidence.

FILES TO MODIFY: existing merchant/payment/auth/integration services, catchall API, checkout services/worker, private schema/exports, navigation, runbook/status/evidence. No database replacement or unrelated service.

- [x] 1. Verify prerequisite evidence and accepted bounded inventory, review data/UX/threat plan.
- [x] 2. Add typed tenant resources: contacts, payment links, invoices/internal collection orders, scoped API keys, webhook config/deliveries, review notes/settings/session controls; migrate isolated target first.
- [x] 3. Implement contacts create/edit/archive/history and fixed links create/list/copy/open/deactivate/expiry; honest outstanding authorization window.
- [x] 4. Implement invoices with optional private contact/due date/notes, printable view, overdue/paid/refunded derived state and eligible void. No-code collections must use durable internal orders rather than require an external merchant order API; external store mode keeps its strict authenticated price/order reads.
- [x] 5. Implement dated overview gross/refunded/net/counts/chart; payment search/status/date/sort/pagination/details. Accepted canonical money is distinct from risk/delivery. All aggregates use exact SQL numerics and current canonical refunds.
- [x] 6. Implement scoped key generation/reveal-once/hash/revoke/rotation and correct REST/JS/Python examples; actual setup/config test.
- [x] 7. Implement approved webhook/order URLs, encrypted secrets/reveal-once rotation, labeled test event, delivery errors/bounded eligible replay; SSRF/origin checks and endpoint revalidation. Test events never fulfill orders.
- [x] 8. Implement risk source freshness/coverage, current refresh, notes/evidence-based review resolution, settings/pause/session revocation, profile/domain/proven wallet controls and audited changes. No merchant hard-denial override.
- [x] 9. Export filtered exact reports with formula-safe CSV; verify every action/persistence, two-tenant isolation, races and responsive/keyboard/error states; independent review and fixes.
- [x] 10. Update actual evidence and push coherent milestones; report remaining live gates. All phases are authorized; preserve pending live gates.

Critical path: typed schema→services→API→UI. Internal collection mode must be integrated into authorization/observer/status before links/invoices can be called complete. Preserve external-store idempotency and historical settlement wallets. Settings/profile edits cannot rewrite existing invoice/payment/refund facts.

Pre-code independent review: PROCEED. Implement typed tenant-bound internal collection mode; recheck pause/link/invoice state under the authorization lock and current fulfillment; separate scoped key rows from durable integration config; persist canonical source block timestamps and use period inflows minus period refund outflows consistently; distinct nonfinancial webhook tests and separate capped/cooldown replay budget. Do not create fake financial payments for endpoint tests.

## Security and state review

Each mutation validates strict schema, cookie origin, tenant and current version; audit and job transition share a transaction. Contacts remain private. Immutable amount/currency/settlement snapshots bind issued checkout. Link deactivation/void/pause blocks new authorization; previously signed payloads can survive until their short onchain expiry, disclosed accurately. A late valid chain payment is retained and reviewed, never discarded as unpaid.

API keys use random material shown once, hash lookup and explicit scope checks. Revocation is immediate for subsequent server requests; rotation creates an auditable replacement. Configured webhook/order URLs match approved merchant HTTPS origin (explicit local-loopback exception), reject credentials/fragments and use existing DNS-pinned bounded transport. Secret rotation and endpoint changes must not turn old eligible events into duplicate fulfillment; stable IDs/current eligibility remain mandatory. Rate/cooldown/attempt caps apply to tests/replay. Test events have a separate non-fulfilling type.

Risk resolution requires current fresh checks and chain/refund/order revalidation; review notes alone cannot clear a hard denial or an orphan. Pause affects new payment authorization and fulfillment, not custody or freezing a wallet. Preserve session expiry/reauthentication states and require fresh ownership proof for settlement changes. CSV protects leading formula characters, quotes/newlines and exact amounts; no floating-point totals.

## UX and checks

7 November verification:114 root tests and16 browser cases pass, including actual wallet/Neon dashboard CRUD and explicit interface fixtures. Desktop/tablet/mobile captures were inspected; source-time and nested history states are covered. See PROGRESS.md and the audit.

Merchant enters overview→payments/detail or create link/invoice; create/edit forms validate inline, persist, confirm and survive reload. Contacts can be archived while historical invoices retain their facts. Developer settings reveal a new key once and explain server-only use; copy controls work and report failure. Webhook test/retry shows a real result/history, with disabled reasons when unavailable. Review details show source/time/coverage and an explicit reason when resolution cannot proceed.

Every screen has loading, empty, invalid/error with retry, permission/session-expired, pending and success states. Destructive revoke/void/deactivate/rotation use explicit confirmation. Keyboard focus remains visible, dialogs trap/restore focus, back/forward and mobile detail views work. Render 390×844,768×1024,1440×900 and stress long labels/amounts. No fake statistics or unused navigation.

Exit: every inventory action tested through real persistence/API and browser reload; cross-tenant access denied across resource families; exact aggregate/CSV formulas and state transitions verified; source/authorization/refund/replay rules preserved; reviewed responsive UI and verified GitHub checkpoints. Funding-dependent evidence remains open rather than silently passed.
