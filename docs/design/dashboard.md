# Merchant operations dashboard

Mode: Operate. Routes `/dashboard` and `/dashboard/[section]`. This is an ordinary extension of SettleKit's approved graphite/mint system, not a replacement brand or speculative admin template. DESIGN.md remains authoritative.

## Direction contract

THESIS: Make the state of money and the next business action clear in one working view. Payments, delivery, screening and refunds remain separate facts; direct settlement is never represented as a gateway balance.

OWN-WORLD: Self-hosted Manrope, graphite working surfaces, one-pixel tonal boundaries, restrained mint action/selection and semantic amber/rose. Use the actual existing palette and 13/14px operational text, tabular amounts, readable long identifiers, compact 7px controls and 15px work panels. No gradients, fake activity or decorative market charts.

STORY: Overview → inspect/filter payments → collect through a real link or invoice → maintain private contacts → configure server integration/webhooks → review delivery/risk → export exact reports. Settings and audit remain easy to find. Every navigation item leads to a complete working resource. Refund/accountant controls are added only with Phase 4's real services.

FIRST VIEWPORT: Familiar persistent rail, environment header, clear section title and one primary task. Overview shows period gross/refunded/net and payment counts derived from current data, an event-derived chart with readable date axis/accessible values, and recent payments. Resource pages lead with a useful table/empty action; detail and form tasks open in properly named focus-managed dialogs or inline work areas. On phones all sections remain reachable through a visible native section selector; tables either reflow or keep bounded local scrolling, never document overflow.

## Section tasks

- Overview: select an explicit date range and inspect exact financial totals and event-derived daily amounts. No invented trend or comparison without source data.
- Payments: search/order/status/date filters, server pagination and exact amount; open current confirmation/risk/refund/delivery detail and immutable references. No browser-return payment acceptance.
- Payment links: create fixed title/USDT amount/expiry, copy/open real public URL, deactivate with confirmation and explain the outstanding signed-authorization window.
- Invoices: optional private contact/due date/notes, fixed amount, copy/open/print and eligible void. Display derived unpaid/overdue/paid/refunded states.
- Contacts: create/edit/archive with private email/name/notes and historical invoice/payment references. Archive preserves prior records.
- Developer integration: scoped keys shown once on creation/rotation, copy with explicit feedback, revoke/rotate confirmation, correct server-only REST/JS/Python examples and a real configuration test.
- Webhooks: approved business URLs, secret rotation/reveal once, real labeled nonfinancial test delivery, current delivery/error history and eligible bounded replay. Infrastructure stays out of merchant setup.
- Reports: explicit range and exact gross/refund/net formula, filtered CSV download with safe text. Export status reflects a real request.
- Risk: actual source age/coverage, current refresh, held-payment details, private review notes and safe evidence-based resolution. Hard denials have no merchant override.
- Settings: profile/domain save, payment pause, fresh settlement proof through the established setup route, active sessions and explicit revocation. Pause never claims to freeze a wallet.
- Audit: bounded/paginated persisted merchant history with useful action/time metadata.

## Interaction and state inventory

Every read: initial loading, true empty state, failed/stale read with retry and session-expired sign-in path. Every mutation: inline field errors, submit pending, failure preserving edits, success feedback and refreshed persisted data. Copy and download failures remain visible. Background refresh never overwrites edited fields.

Destructive actions use an explicit confirmation naming the affected resource. Dialogs have accessible titles/descriptions, initial focus, Tab/Shift+Tab containment, Escape when idle, and focus restoration. Pending operations prevent duplicate submission and ambiguous dismissal. Navigation/back/forward use actual URLs; dialogs remain local transient state and reload restores authoritative resource data.

Amounts use validated integer base units and exact six-decimal USDT formatting; string inputs retain all precision. Positive color requires current successful state. Loading/error/held/source-unavailable states are never optimistic pass claims. Timestamps include the browser's locale; filters state the selected date period.

## Verification

API contract is coordinated in `docs/phases/phase-3-api.md`. Build, API-backed reload/tenant checks and explicit HTTP UI fixtures are distinct evidence. Required captures: 1440×900,768×1024,390×844 for representative overview/table/form/detail/empty/error surfaces; keyboard dialog/navigation checks and worst-case text/amounts. Browser evidence, detector and fresh finish review remain pending until implementation is complete. Live funded payment/refund/Arkiv-write gates remain explicitly open.
