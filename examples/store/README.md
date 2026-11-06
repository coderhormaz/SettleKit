# Fieldwork: independent merchant store

This standalone Node store sells a real downloadable Markdown workbook for **25 test USDT**. It has a separate Neon database/runtime role; the gateway cannot write its orders. Payments settle on Whitechain through the gateway. The browser return only refreshes the store's own order status.

## Run locally

From the repository root, install the pinned workspace and configure the ignored `.env`:

```dotenv
STORE_ORIGIN=http://127.0.0.1:3200
STORE_PORT=3200
APP_ORIGIN=http://127.0.0.1:3000
ALLOW_LOCAL_HTTP=true
STORE_DATABASE_URL=<scoped pooled Neon URL with sslmode=verify-full>
STORE_DATABASE_URL_UNPOOLED=<direct migration connection>
TEST_STORE_DATABASE_URL=<separate isolated test-store pooled connection>
STORE_GATEWAY_API_KEY=<merchant server key, never a browser key>
STORE_WEBHOOK_SECRET=<the matching approved gateway endpoint secret>
STORE_ORDER_READ_KEY=<scoped private order-read credential>
```

All credentials stay server-side. The three integration secrets must contain at least 32 characters; use cryptographically random generated values. The operator configures the matching merchant integration in the gateway, including the exact store origin, webhook endpoint `/api/webhooks/settlekit` and authenticated order-read base `/api/orders/`. Ordinary merchants do not configure RPC/provider/policy infrastructure.

```powershell
node --env-file=.env --import tsx examples/store/src/migrate.ts
node --env-file=.env --import tsx examples/store/src/server.ts
```

The migration uses the direct **store** connection. Apply the same versioned SQL to the separate test store with its migration credentials before integration tests. It creates only `store_orders`, `store_receipts` and `store_review_events`. The runtime should have data access to these tables and sequence, without schema/admin rights.

## Integration contract

The catalog price lives on this server. `POST /api/orders` ignores browser prices, persists an order and calls `POST /api/v1/checkouts` using a merchant server key, the order UUID as idempotency key and the stored 25,000,000 base-unit amount. A failed/ambiguous response leaves the order saved. The owner can retry the same checkout request without making a new logical order.

`GET /api/orders/:id` requires the private order-read bearer credential and returns only `order_ref`, exact amount, state, associated payment ID and monotonic state version. It exposes no customer data. The browser uses the limited `/api/orders/:id/status` projection and receives its own random order capability only when creating the order. That capability permits reopening/cancelling the pending order and downloading its fulfilled workbook; its hash stays in the store DB. It is never a gateway API credential or wallet private key.

The receiver verifies bounded **raw bytes**, `x-settlekit-timestamp`, `x-settlekit-signature: v1=<hex>`, and a 300-second timestamp tolerance. It retrieves current eligibility through the authenticated gateway endpoint, matches all payment/order/amount/chain/token/wallet facts, and accepts only a grant expiring within 15 seconds. A new fulfillment needs the matching current accepted version, eligible participants, no refund hold and zero refunded amount. The grant is rechecked after acquiring the store's order lock.

Receipt deduplication, order/payment association and the entitlement effect share one store transaction. A unique payment association and `fulfillment_count <= 1` also protect against distinct event IDs for the same payment. Concurrent cancellation is serialized by the same order lock. An orphan/review correction after delivery records `CORRECTION_AFTER_FULFILLMENT` and holds the order; it cannot revoke a file already downloaded. Gateway and store commits are separate systems: a fresh grant bounds a race, but does not create cross-system atomicity.

Configured outbound origins are pinned and bounded. HTTPS uses DNS validation and a pinned connection address, blocks private/metadata/reserved targets and rejects redirects. Explicit loopback is available only with local-development configuration. There is no generic URL-fetch endpoint.

## Verification and scope

```powershell
node --import tsx node_modules/vitest/vitest.mjs run packages/integration/test
```

The protocol suite checks raw-body/timestamp/credential tampering, invalid exact amounts, superseded/refund/review state and transport restrictions. Real isolated PostgreSQL checks exercise concurrent retries, different event IDs, cancellation, corrections after fulfillment, association mismatch and grant expiry while waiting for a lock. Local tests are not Whitechain payment evidence.

With the matching local gateway/store integration configured and both servers running, the additional checks use actual HTTP and development-branch persistence:

```powershell
node --env-file=.env --import tsx examples/store/scripts/verify-integration.ts
node --env-file=.env --import tsx examples/store/scripts/verify-flow.ts
```

The first checks server-owned pricing, key/origin boundaries, request bounds, idempotency and real pending status. The second creates a real order in Chromium, follows the real hosted checkout, checks the unavailable-payment gate, and returns to the still-pending store order at 1440/768/390 widths. The unavailable-gate assertion deliberately applies to the current pre-deployment configuration. Sanitized results are in `evidence/local-http.json` and `evidence/browser-flow.json`. No wallet transaction, payment acceptance or fulfillment is invented.

This reference intentionally shows the complete custom merchant server, order transactions, authenticated order reads, public status/cancellation/download UI and setup. Do not describe its full integration as a 20-line snippet or claim an unmeasured integration time. Shared protocol/HTTP helpers are reusable; production merchants connect the transaction callback to their own order system.

Implementation inventory on 6 November 2026: custom HTTP server 86 physical lines / 8,370 bytes; merchant order transactions 80 lines / 7,027 bytes; static UI 12 lines / 12,045 bytes; migration 32 lines / 1,369 bytes; reusable protocol/transport helper 144 lines / 10,459 bytes. The HTML/CSS/JavaScript strings use compact long lines, so physical line count understates their size. Setup, order reads and transaction callbacks are included above; hands-on integration time has not been measured.

The store extends the pinned graphite/mint world. Its pale workbook preview intentionally adds paper/ink colors `#e9eee9` / `#183029` and a quiet rule `#b5c3ba` to distinguish the downloadable document from application chrome. The visual detector reported advisory color/radius/type additions, with no hard findings; these are not a claim of detector `[]`. Initial desktop/tablet/mobile rendering and keyboard focus were inspected through the actual store server on a temporary preview port. Preview-only credentials were explicitly fake and no checkout call was made in that visual pass; functional payment/fulfillment evidence is separate.

No public app hosting or customer funds are used. Source verification and an actual 25-USDT Whitechain payment/one-store-fulfillment remain live evidence gates until funded and executed.
