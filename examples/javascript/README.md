# Small JavaScript integration

`server.ts` is a server-only REST/protocol client. `browser.ts` exports a separate redirect helper with no key or server imports. `adapter.ts` joins the client to the independent store's existing Neon order transactions; it provides checkout creation, authenticated order reads and verified notifications. No additional dependency or alternate database is introduced.

Use the repository's pinned workspace. The complete runnable HTTP merchant is [Fieldwork](../store/README.md), including durable orders, cancellation, entitlement, receiver idempotency and setup. Run it with:

```powershell
node --env-file=.env --import tsx examples/store/src/migrate.ts
node --env-file=.env --import tsx examples/store/src/server.ts
```

The following is the server glue for a merchant reusing that order schema. Keep all three credentials private; obtain the server key and receiver secret through the real dashboard. Approve the store's origin and configure its webhook/order-read URLs there.

```ts
import { SettleKitClient } from './server.ts';
import { createMerchantAdapter } from './adapter.ts';
import { createStoreDatabase } from '../store/src/store.ts';

const pool = createStoreDatabase(process.env.STORE_DATABASE_URL!);
const client = new SettleKitClient({
  gatewayOrigin: process.env.APP_ORIGIN!,
  storeOrigin: process.env.STORE_ORIGIN!,
  apiKey: process.env.STORE_GATEWAY_API_KEY!,
  webhookSecret: process.env.STORE_WEBHOOK_SECRET!,
  allowLocal: process.env.ALLOW_LOCAL_HTTP === 'true',
});
const adapter = createMerchantAdapter(pool, client, process.env.STORE_ORDER_READ_KEY!);

// In a buyer-authenticated server route: order ID belongs to the current buyer.
const checkout = await adapter.checkout(order.id);
// Return only the validated checkout URL; the browser imports browser.ts.

// GET /api/orders/:id, protected by the private order-read bearer credential:
const orderProjection = await adapter.orderRead(orderId, request.headers.authorization);

// POST /api/webhooks/settlekit: bounded raw body BEFORE any JSON parser:
const result = await adapter.webhook(rawBody, timestampHeader, signatureHeader);
```

Your HTTP server must also bound requests, handle errors as safe codes, protect buyer routes and supply the existing authoritative order. The complete reference server does this. Browser JSON never supplies a trusted amount. Use the order's persisted identifier as the idempotency key; an ambiguous checkout response is retried against that same order.

```ts
// Browser code only: checkout_url came from your own authenticated store route.
import { redirectToHostedCheckout } from './browser.ts';
redirectToHostedCheckout(checkout_url, gatewayOrigin, explicitLocalDevelopment);
```

A return URL or transaction hash never marks an order paid. The receiver validates raw bytes/timestamp/HMAC, then fetches current eligibility through a scoped server key. The store transaction locks the order, verifies association and grant expiry, deduplicates the event/payment and applies one fulfillment. Corrections create review exposure; already downloaded goods cannot be undone. An `endpoint.test` acknowledges configuration only and never fulfills.

This is a complete reusable adapter, not a claim that an arbitrary merchant can integrate in 20 lines. Count the helper, order-read route, configuration, error handling and merchant transaction callback, including the reused [store implementation](../store/). Physical line counts understate compact long lines; the implementation audit reports both bytes and lines. Integration time has not been measured.

Implementation added after the user's request to finish remaining code before further tests. These new helper files have not been separately executed or browser-tested; the earlier independent store evidence applies to the existing store, not automatically to these new exports.
