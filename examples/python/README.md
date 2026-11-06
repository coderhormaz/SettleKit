# Runnable Python merchant adapter

This standard-library Python service demonstrates raw-body HMAC verification, authenticated current payment reads, approved-origin/DNS-pinned HTTP, authenticated merchant order reads and a real durable fulfillment callback. It adds **no SQLite, in-memory order store, database replacement or Python package dependency**. Orders and fulfillment remain in the existing independent merchant store's separate Neon PostgreSQL database.

Python is the public merchant HTTP adapter; the existing Node store is its private durable order backend. The Python callback forwards the original signed event to that backend, which independently rechecks eligibility and commits receipt deduplication, payment/order association and one entitlement in its existing Neon transaction. This is a working language-independent adapter around a real merchant order system, not a claim that Python's standard library contains a PostgreSQL driver.

## Local configuration

Use ignored `.env` values in your existing workspace. Change the merchant's approved website origin to `http://127.0.0.1:3300`, webhook URL to `/api/webhooks/settlekit` on that origin, and authenticated order API base to `/api/orders` on that same origin. Save the matching one-time webhook secret privately. The server API key needs both `checkout:create` and `payment:read` scopes.

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
ALLOW_LOCAL_HTTP=true
STORE_ORIGIN=http://127.0.0.1:3300
STORE_PORT=3200
PYTHON_STORE_BACKEND_ORIGIN=http://127.0.0.1:3200
STORE_DATABASE_URL=<existing separate merchant Neon pooled connection>
STORE_DATABASE_URL_UNPOOLED=<merchant direct migration connection>
STORE_GATEWAY_API_KEY=<private merchant server key>
STORE_WEBHOOK_SECRET=<matching private signing secret>
STORE_ORDER_READ_KEY=<matching private order-read credential>
```

The Node backend listens at port3200 while its configured **external store origin** is3300. Consequently checkout return URLs, CSRF checks and the gateway's approved merchant origin agree with the Python frontend. Do not run a second store with conflicting configuration on port3200.

Start the gateway with its existing root command. Start the merchant backend after the existing store migration:

```powershell
node --env-file=.env --import tsx examples/store/src/migrate.ts
node --env-file=.env --import tsx examples/store/src/server.ts
```

Python itself does not parse dotenv. Use the installed Node runtime's dotenv-file support to start Python with inherited private environment values, without printing them:

```powershell
node --env-file=.env -e "const {spawn}=require('node:child_process'); const p=spawn('python',['examples/python/server.py'],{stdio:'inherit',windowsHide:true}); p.on('exit',code=>process.exitCode=code??1)"
```

Open `http://127.0.0.1:3300`. The existing store UI runs through the Python adapter: server-priced order creation, hosted checkout, return status, cancellation and the actual fulfilled workbook entitlement. Nothing marks an order paid from a return URL. Funding-dependent router/payment/refund evidence remains open.

## Adapter contract

- `verify_webhook(raw,timestamp,signature,secret)` verifies the bounded original bytes, timestamp tolerance and constant-time HMAC comparison. Call it before parsing or responding to test events.
- `fetch_current_eligibility(payment_id,gateway_origin,server_key,allow_local)` uses the private scoped key over the fixed gateway origin. `receipt_disposition` validates exact amounts, chain1874/sponsor USDT, payer/merchant/order/payment association, current version, confirmation, refund hold/amount and short grant.
- Nonfinancial `endpoint.test` events are acknowledged without fetching an order or fulfilling anything.
- The actual callback is the existing store's signed receiver: it re-reads eligibility, locks the order, rechecks grant expiry and atomically deduplicates/applies fulfillment. Corrections remain review events. A Python merchant with its own PostgreSQL code can replace this callback with its equivalent transaction; a bare in-memory callback is insufficient.
- Authenticated order reads are exposed on the approved merchant origin and delegated to the actual durable order backend. No contact data, provider responses or secrets are projected.
- Outbound requests use `urllib` with custom pinned connection handlers, verified TLS/SNI, no environment proxy, no redirects, bounded bytes/deadlines and rejected private/reserved DNS results. Explicit loopback is permitted only in local mode. Incoming proxy paths and backend origins are fixed; there is no generic URL fetch endpoint.

Include the full order system, read route, credentials/origin setup, bounded transport and atomic callback when estimating integration work. Neither an honest20-line count nor measured integration time is claimed. Compact physical lines alone are not a reliable complexity measure.

Verification resumed7November2026. The actual Python public HTTP adapter, authenticated order reads and signed durable callback run in the complete local EVM/mock-token + production HTTP/isolated Neon harness, including actual CRE recovery/one fulfillment and5USDT refund. Reproduce with `node --env-file=.env --import tsx packages/contracts/scripts/local-payment-flow.ts --refunds --collections --recovery --python`. Seven additional Python checks cover money/chain types, HMAC, refund/version/grant boundaries, private DNS, real HTTP redirects/response limits and signed malformed/test callbacks: `python -m unittest discover -s examples/python -p 'test_*.py'`. Chain/order responses in those unit cases are explicit fixtures. No funded Whitechain or signed Arkiv proof is inferred.
