# Local operator runbook

Updated 7 November 2026. The user resumed runtime verification. Gateway/store backup and isolated restore have now been exercised; see the release checklist for the remaining evidence boundaries. Public application hosting is deferred.

## Private configuration

Copy `.env.example` only for a fresh checkout; preserve an existing `.env`. Keep secrets out of Git, browser bundles, screenshots and chat. `data/`, backups and `.tools/` are ignored. Local services require internet for Neon/sponsor RPCs.

| Configuration | Purpose |
| --- | --- |
| `APP_ORIGIN`, `STORE_ORIGIN`, `ALLOW_LOCAL_HTTP` | Exact approved local origins; HTTP allowed only as explicit loopback development |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Gateway pooled limited runtime role / direct migration role |
| `STORE_DATABASE_URL` / `STORE_DATABASE_URL_UNPOOLED` | Separate merchant database and roles |
| `TEST_DATABASE_*`, `TEST_STORE_DATABASE_*`, `TEST_DATABASE_ISOLATED` | Separate isolated test branch/databases |
| `DATA_ENCRYPTION_KEY` |32 random bytes in hex; encrypts recoverable server credentials |
| `STORE_GATEWAY_API_KEY` | Private `checkout:create` and `payment:read` scopes |
| `STORE_WEBHOOK_SECRET`, `STORE_ORDER_READ_KEY` | Matching receiver signing and merchant-order read credentials |
| `WHITECHAIN_ROUTER_ADDRESS`, `_CODE_HASH`, `_DEPLOYMENT_BLOCK` | Actual deployment evidence; unset disables executable checkout |
| `PAYMENT_AUTHORIZER_PRIVATE_KEY`, `POLICY_ADMIN_PRIVATE_KEY` | Separate platform signer/policy roles |
| `ARKIV_WRITER_PRIVATE_KEY`, `ARKIV_ACCESS_KEY` | Private signed public-projection writer |
| `ARKIV_PUBLIC_WRITER_ADDRESS` | Public accountant trust anchor |
| `RECOVERY_SERVICE_TOKEN`, `CRE_MERCHANT_WALLET` | Private recovery capability and selected merchant |
| `ALLOW_DEVELOPMENT_FAILURES`, `STORE_DEVELOPMENT_FAILURE_TOKEN`, `DEVELOPMENT_DELIVERY_ATTEMPTS` | Explicit local failure fixture; default disabled/five attempts |

Runtime URLs are pooled limited roles; migration/admin URLs are direct. All use TLS `verify-full`. Do not rotate the encryption key by simply replacing it: existing ciphertext needs controlled decrypt/re-encrypt migration. API-key and webhook-secret rotation are real dashboard operations; save the new value privately, update the matching store and restart its process. Keep order-read secrets synchronized. No automatic encryption-key rotation/KMS is claimed.

## Setup and services

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
node --env-file=.env --import tsx examples/store/src/migrate.ts
pnpm screening:import
pnpm build:all
pnpm stack start
```

`pnpm demo:setup` is an optional operator action using the already generated ignored test wallet. It signs that demo merchant's login, saves the Fieldwork profile/endpoints and privately writes matching credentials. It changes that demo configuration and preserves existing integration secret values. If dashboard scoped keys exist, use a currently valid scoped key: the legacy demo key cannot bypass revocation.

The supervisor owns gateway3000, store3200, accountant3400 and worker children; it refuses occupied ports. `pnpm stack status` reports HTTP readiness/heartbeats, not successful source/policy/jobs. `pnpm stack stop` allows 75seconds then stops only owned children. It never kills a PID from stale metadata. Standalone alternatives are `pnpm start`, `pnpm store`, `pnpm accountant`, `pnpm worker` in separate terminals. Do not mix two services on one port. The accountant can remain up with the gateway/worker stopped.

## Policy and money

Follow [router deployment/verification](../packages/contracts/README.md) with actual test-role funding, exact Whitechain USDT, code hash and deployment block. Funding is user-deferred; do not substitute another token/network for proof.

`pnpm screening:import` persists the official-source snapshot. Worker refreshes hourly and fails closed on source failure. `pnpm policy:sync` is read-only preflight; `pnpm policy:sync --broadcast` needs funded policy admin and synchronizes the reviewed commitment/epoch/denials. Import does not itself send a transaction. Expired policy or an unsynchronized source blocks signatures. Coverage is narrow address-list matching, not a compliance guarantee.

Dashboard Risk refresh/notes/resolution use current canonical evidence; no hard denial/refund hold can be overridden. Partial refunds remain review holds. Unsolicited direct transfers never fulfill, forward or automatically refund.

Create refunds in payment details. The original merchant supplies gas, allowance and transaction; the service only issues short screened authorization. Only canonical events change refunded amounts. Cancellation/expiry rechecks chain state and outstanding authorization windows before releasing a reservation. Webhook delivery is separate from payment. A reorg/correction after download records review exposure; it cannot undo delivered digital goods.

## Durable publication and recovery

Arkiv writes use a global owner lease, bounded jobs, source verification and query-first crash repair. Retention is 90 days; renewal starts near 14 days remaining. Expiry is an Arkiv block height. Public payloads contain minimal chain facts. After repairing funding/configuration and exhausting normal retries:

```powershell
pnpm receipts status
pnpm receipts retry
```

Retry checks funding/configuration, skips active work, queues at most 100 failed/blocked mappings and records an operator audit. It changes no money and proves no signed write; the worker must persist actual entity keys. `awaiting_source` correction work waits for the real replacement-block timestamp. Incomplete public history remains visible in independent coverage. Notification recovery uses the [CRE runbook](phases/phase-5-runbook.md); a normal retry/manual replay never counts as actual CRE proof.

## Backup and isolated restore

Use already installed trusted PostgreSQL 17 tools, optionally selected with `PG_DUMP_PATH` / `PG_RESTORE_PATH`. The script checks actual major version, never installs tools or creates databases, and passes credentials through `PG*` environment rather than connection URLs in argv. This workstation uses portable PostgreSQL17.11 clients downloaded through the official PostgreSQL Windows/EDB binaries links; no PostgreSQL server was installed.

TLS remains `verify-full`. On Windows, when `PGSSLROOTCERT` is absent, the helper exports the installed Node runtime's public trust roots into ignored `data/backups/`; this supplies libpq's missing default CA bundle without disabling certificate or hostname verification. An explicit `PGSSLROOTCERT` selects your own CA bundle. Restore authentication/TLS/permission failures emit bounded codes rather than provider output or credentials.

```powershell
pnpm db:backup --database gateway
pnpm db:backup --database store
```

Custom archives/checksum manifests remain under ignored `data/backups/` and contain private data. Restrict access and retention. POSIX mode is not a Windows ACL guarantee.

Pre-create an **empty** `settlekit_restore_<suffix>` database on the isolated test branch. Privately set its direct `RESTORE_DATABASE_URL_UNPOOLED`. Restore rejects existing app/test databases or a test host shared with the default app. It requires `TEST_DATABASE_ISOLATED=true`, matching archive/hash and exact name:

```powershell
pnpm db:restore --database gateway --file data/backups/<archive>.dump --confirm-target settlekit_restore_<suffix>
```

No `--clean`, drop/create or runtime URL replacement is performed. Restore is one transaction, stop-on-error. Actual gateway and store archives were restored into separate isolated `settlekit_restore_*` databases and checked for schema/data counts. Archives omit ownership and grants: before any future deliberate cutover, reapply and verify limited runtime roles/grants and configure credentials privately. This exercise did not cut over either running application. Backups also require the matching encryption key to recover encrypted configuration; retain it privately under separate access control.

Logs emit safe codes. `pnpm audit:secrets` compares local credentials with staged files and both generated client bundles; it complements source review. Fetch before normal pushes and verify remote SHA. Hosting, submission, customer funds and sponsor messages remain separately authorized.
