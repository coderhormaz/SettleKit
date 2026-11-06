# Phase 1: foundation and feasibility

Started: 6 November 2026 (IST). User authorized Phase 1 only. Status: independent implementation/checks passed; two user-deferred funded testnet gates remain open. See `PROGRESS.md` and the evidence index.

## Scope and architecture review

The repository contains project documentation only. The approved stack is Next.js/React/TypeScript, Neon PostgreSQL/Drizzle/pg, wallet-signature identity, deterministic screening, official Arkiv/CRE SDKs and a persistent worker. No preceding implementation must be preserved. Sponsor requirements were re-read on this date; the exact chain/token and current Rabdi identifiers remain fixed by the handoff.

Chosen approach: one small shared server-domain/database package called by Next Route Handlers and the persistent worker, with pure validation/money/screening modules outside the transport layer. This keeps session/tenant and transaction rules consistent. A separate API service would duplicate deployment/authentication boundaries without helping this phase; a browser-facing database would expose private operating state. No public deployment, customer payments or Phase 2 router is authorized here.

Pre-code review: PROCEED, with dependency direction `gateway/worker → db server services → screening → browser-safe core`. Screening never imports the database. Browser-safe constants/money/schemas are separate exports from Node crypto, credentials and runtime configuration. The review found no unresolved critical design/UX issue; actual implementation checks remain pending.

Runtime connections use a bounded `pg` pool and Neon pooled URL. Migrations use the direct URL and checked-in Drizzle SQL. Development and integration tests use isolated Neon branches/databases. Exact base units use integer-valued NUMERIC with uint256 bounds and string/BigInt round trips. Outbox creation shares the domain mutation transaction; jobs use transaction-scoped claims, expiry and fenced lease completion. External network calls happen outside database locks.

## Requirements and user journey

User confirmed **wallet first, then business setup** in this phase's onboarding question. The accepted audience is a single-owner digital-service merchant; buyers and accountants are later surfaces. Preserve the graphite/mint visual direction, clear test-environment labels and no infrastructure administration in merchant forms.

Journey: open onboarding → connect injected wallet → switch to Whitechain as required → inspect/sign a domain/nonce/expiry-bound EIP-4361 challenge → create secure session → save business name/website → prove settlement wallet ownership → see persisted setup and current screening outcome → sign out or edit the profile. Login alone is identity, not a claim that screening passed. No checkout/payment controls are exposed in Phase 1.

States: connecting/loading, no wallet/install guidance, wallet rejected, wrong network, invalid/expired/replayed signature, session expiry, empty initial profile, inline validation, saving/saved/error, required screening unavailable/stale/blocked/review, lost database connection and reload with persisted data. Every failure offers retry/back/sign-out where appropriate. Do not invent metrics or expose future dashboard navigation.

Security gates: browser-bound single-use nonce; atomic consumption/session creation; expected domain/URI/chain/address and expiry; hashed high-entropy session tokens, HttpOnly/SameSite cookies, strict mutation origin checks, explicit local-HTTP exception only; tenant derived from session; fresh proof/screening for settlement wallet; private encrypted sensitive configuration; redacted errors; bounded/validated public-source ingestion; no required-data failure converted to allow. Screening coverage is a direct-list baseline, not illicit-funds tracing. No contract enforcement is claimed until Phase 2.

## Files to create

- Root workspace/config: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.github/workflows/ci.yml`.
- Product/design: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` and a route surface brief with tokens, user states and direction contract. Product context precedes UI code; the finished build is checked against it.
- `packages/core/src/*`: shared chain constants, exact-money validation/formatting, structured application errors, encryption/redaction and shared schemas; tests for security/money boundaries.
- `packages/db/src/*`, `packages/db/drizzle/*`: PostgreSQL schema/client, SIWE identity/session/profile services, private screening persistence, atomic outbox/lease services, migration runner and actual database integration tests.
- `packages/screening/src/*`: validated official published-wallet-address importer, source snapshots/freshness and deterministic decisions; malformed/outage/denial/cache tests.
- `packages/worker/src/*`: persistent scheduled source import/health and durable job polling with restart-safe state.
- `apps/gateway/app/*`: layout/theme, wallet-first onboarding and persisted profile/setup; `/api/auth/{challenge,verify,logout,me}`, `/api/merchant`, settlement proof and scoped screening routes; browser tests.
- `packages/feasibility/*`: official SDK import/network probes, throwaway local-wallet tooling and Arkiv round-trip script; sanitized output only.
- `packages/cre/*`: real official CRE workflow/config and diagnostic merchant API for the HTTP/Whitechain route proof. Bun/WASM remains isolated from the application's Node runtime.
- `docs/versions.md`, `docs/evidence/index.md`, `docs/evidence/phase-1/*`, attribution/AI-use/sponsor feedback files: actual outcomes and explicit blockers. No invented integration evidence.

## Files to modify

- `.gitignore`: protect all local env, Neon context, test wallets, downloaded tooling, raw logs, browser profiles and database dumps; commit only reviewed sanitized evidence.
- `README.md`: exact local install/migration/start/test/probe instructions and current limitations.
- `AGENTS.md`, `MEMORY.md`, `PROGRESS.md`, `PROJECT_HANDOFF.md`, `IMPLEMENTATION_PLAN.md`: Phase 1 status/evidence and next unfinished gate; preserve accepted scope.

## Task order and live checklist

- [x] 1. Complete architecture/UX/security review and resolve current SDK/toolchain metadata; establish product context (this plan, PRODUCT.md).
- [x] 2. Bootstrap pinned workspace/shared types; install and perform real import/type/build checks; record any compatibility substitutions.
- [x] 3. Establish selected Neon development/test targets, private configuration, versioned schema/migrations, exact-money round trips, transaction rollback/outbox and fenced worker-lease integration checks.
- [x] 4. Implement/test official-source screening ingestion and fail-closed freshness/coverage policy, persistent decisions and worker source health.
- [x] 5. Implement/test browser-bound SIWE login, session/logout, tenant-isolated profile and settlement proof/screening.
- [x] 6. Implement and inspect the polished wallet-first onboarding shell and complete UI states at mobile/tablet/desktop sizes.
- [ ] 7. Prove exact Whitechain token/network behavior and test funding paths; real Arkiv create/read/browser access; real CRE HTTP/RPC plus diagnostic store API simulation. Preserve exact blocked gates while continuing independent tasks.
- [x] 8. Run relevant independent integrated checks, fresh code/design review, fix findings, update evidence/memory and verify GitHub milestone push `4ee6743`. Report funded gates accurately. The user's subsequent Phase 2 instruction supersedes the former wait instruction.

Critical path: schema/types precede domain/worker/UI; browser security precedes login/profile writes; valid source snapshots precede allowed screening; test funding precedes real Arkiv writes/token operations; CRE tooling/account access precedes its simulation. Independent sponsor/access work may progress while the local foundation is built.

## Acceptance and evidence

| Gate | Required proof | Current status |
| --- | --- | --- |
| Toolchain | Reproducible lockfile install, official SDK imports, typecheck, app build, supported contract tooling spike | Passed; compatible TS5.9.3 pin documented |
| Private persistence | Actual Neon migration, exact monetary boundary round trips, atomic rollback/outbox, concurrent/fenced leases and restart/reconnect checks | Passed: actual isolated PostgreSQL tests |
| Identity/isolation | Real EIP-4361 signatures, browser/nonce/domain/expiry/replay checks, logout, two-merchant profile/settlement/decision isolation | Passed: backend signatures/isolation + browser flow |
| Screening | Actual current official source import with source URL/hash/coverage/time; hard-match fixtures, stale/malformed/unavailable decisions and safe refresh publication | Passed: live import + synthetic edge tests; source-health race fixed |
| UI | Working login/profile/proof states, persisted reload, responsive screenshot inspection and keyboard/error checks; skill review/detector findings resolved | Build/3 browser tests/5 captures pass; visual ship, detector []; limits recorded |
| Whitechain | ID/token metadata and actual approval/transfer/funding behavior for separate test roles, without substituting another token | Metadata/read-only simulations pass; funded signed proof deferred |
| Arkiv | Actual funded writer, entity key, reproducible query and independent browser read | SDK/public browser queries pass; funded entity write/read deferred |
| CRE | Actual CLI/Bun build and simulation calling Whitechain RPC and separate diagnostic merchant API; labeled as simulation | Passed actual CLI simulation; no native-support/recovery/deployment claim |

Each milestone records commands actually run, results, sanitized references, commit/remote verification and precise access blockers. Local fixtures/mocks never satisfy the live sponsor gates. External blockers do not authorize weakening the product or claiming the whole phase complete.
