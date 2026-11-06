# Phase 2 local operation

Use the existing ignored `.env`; copy only placeholders from `.env.example` on a new checkout. App/worker run locally and use Neon. The separate store has its own database and least-privilege role; it cannot write gateway payments. Direct URLs are for versioned migrations; pooled URLs are for runtime.

## Start and review

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm screening:import
pnpm build
pnpm start
# Separate terminals:
pnpm store
pnpm worker
```

Gateway: http://127.0.0.1:3000; independent store: http://127.0.0.1:3200; basic merchant payments: http://127.0.0.1:3000/payments. The wallet-first setup links to payments on mobile and desktop. Public application hosting is deferred.

The local operator's `scripts/setup-demo.ts` uses the already generated test merchant wallet to prove identity, save the Fieldwork profile and register encrypted integration credentials in the private database. It saves matching store credentials in ignored `.env` and never prints them. `scripts/provision-store.ts` is a one-time setup for this project's already-created named store databases, preserves existing credentials and refuses to reset roles. See the [separate store guide](../../examples/store/README.md) for the receiver contract and complete integration inventory.

Without an actually configured router, checkout shows an unavailable deployment gate. A redirect or submitted hash never means paid. Local mock-token/EVM checks are explicitly separate from the live Whitechain payment required by the sponsor.

## Funded testnet gates

The user deferred faucet funding. Keep private role keys in `data/phase-1-wallets.json`. The deployer and policy admin also need test WBT; payer needs test WBT and the exact sponsor USDT. No production funds are used. Do not replace the asset/network to bypass this gate.

Follow [contract deployment and verification](../../packages/contracts/README.md). Preflight defaults to read-only; `--broadcast` is explicit. After a successful deployment, source-verify the router using the documented Whitechain Blockscout configuration and record the actual explorer result. Configure address, deployment block and runtime code hash from checked evidence, never invented values. The router is non-upgradeable and already includes tested payment/full-partial refund primitives.

```powershell
pnpm policy:sync
# Once test funding and deployment are present:
pnpm policy:sync --broadcast
```

Policy admin and authorization signer are separate test roles. A fresh official source is required. The operator synchronizes its commitment, increasing epoch and hard-denial set onchain; omitted denials remain blocked pending explicit reviewed release. Changed source commitment, pause, expired policy or unconfirmed synchronization prevents new signatures. Policy validity is at most two hours from successful source retrieval; executable payment authorizations last at most 60 seconds and never outlive their evidence. The router additionally enforces current epoch, hard denials, pause and onchain validity. Re-run synchronization after each successful source import; the hourly importer does not imply a funded policy transaction succeeded. No claim of instantaneous discovery/revocation is made.

Complete the actual store's 25 USDT checkout, exact needed approval and router payment. Observer acceptance requires two included blocks (soft confirmation), full canonical receipt/authorization association and atomic state/outbox persistence. Save a genuine explorer link in README and evidence. No phase is fully complete from a simulation alone.

## Failure and recovery behavior

Delivery is at-least-once, with a stable event ID, timestamped raw-body HMAC, live fenced lease, five-attempt default budget/backoff and dead state. It rescreens current evidence and checks current canonical payment, onchain refund total, private refund hold and authenticated store order before new fulfillment. The receiver obtains a short current eligibility grant, revalidates it after locking the order, then atomically records receipt and logical fulfillment once. Grants never outlive source/onchain policy expiry. Secret configuration/rotation UI and merchant replay controls belong to Phase 3; CRE recovery belongs to Phase 5.

Source or RPC failure pauses new execution; it is not proof of an orphaned payment. An actual canonical block mismatch creates one corrective review notification. Onchain refund totals immediately hold new fulfillment even before Phase 4's refund UI exists. Cancellation/old versions/review/refunds cannot revive fulfillment. Cross-system transitions cannot be one PostgreSQL transaction: a correction after delivery records exposure for review; it cannot undeliver digital goods or freeze a merchant wallet. A submitted transaction may still confirm after retry; the router accepts an invoice only once, and the UI explains gas costs before an explicit retry.

## Reproduce checks

```powershell
pnpm test:contracts
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

`pnpm test` requires the explicitly isolated Neon targets and includes actual database concurrency plus clearly labeled HTTP/RPC fixtures. Browser onboarding uses real signatures/persistence; Phase 2 wallet-payment UI states use explicit HTTP/RPC fixtures. The separate store's matching-key local HTTP/browser evidence uses actual running services and Neon while leaving the order unpaid because no router is deployed. Live explorer, signed Arkiv and CRE recovery proofs remain distinct.
