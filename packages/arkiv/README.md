# Public receipt projection

This package separates browser-safe receipt schema/query/source verification from the server-only signed writer. Use `@settlekit/arkiv` in independent readers and `@settlekit/arkiv/server` only in trusted Node workers. The accountant does not import Neon, gateway history APIs or the writer entry point.

## Public reads

```ts
import { queryReceipts, verifyReceipt, summarizeVerified } from '@settlekit/arkiv';

const page = await queryReceipts({
  writer: configuredPublicWriter,
  merchant: merchantWallet,
  pageSize: 25,
  // Optional: kind, UTC fromDate/toDate seconds, fromBlock/toBlock strings, cursor.
});
const checked = await Promise.all(page.entities.map(entity =>
  verifyReceipt(entity, { writer: configuredPublicWriter, ...publicSourceDeployment })
));
const available = summarizeVerified(checked);
```

The public source deployment contains `router`, `routerCodeHash`, `deploymentBlock` and an optional safe-for-public-client Whitechain RPC URL. Query paging uses immutable keys; continue with `page.nextCursor`. Each page records the Arkiv block at which it was read. Pages are live reads, not one atomic historical snapshot.

`sourceEventId` includes the source block hash, so a re-inclusion can have a distinct entity version. `logicalEventId` excludes it. Verification precedes logical deduplication. Expired, forged-writer, noncanonical and mismatched records never contribute money. Correction evidence must show the referenced block is no longer canonical and contributes zero amount. Exact base units stay as strings/BigInt; no floating point enters totals or CSV.

`scanCoverage` reads up to 500 blocks per call (default 200), pins the stated range to its end-block hash and returns a resumable cursor. It independently verifies matching payment/refund events. `reconcileCoverage` compares source events with verified available entities, exposing missing and unexpected records. A complete Arkiv query and complete consistent source scan are both required before a stated range is reconciled. Missing records may be unwritten, expired or removed; an empty query alone cannot distinguish these causes.

## Server publication

```ts
import { publishReceipt } from '@settlekit/arkiv/server';

const result = await publishReceipt(publicReceipt, {
  privateKey: serverOnlyWriterKey,
  router, routerCodeHash, deploymentBlock,
  whitechainRpcUrl: operatorSourceRpc,
  // Optional server-only arkivRpcUrl and accessKey.
});
// result: { entityKey, expiresAt: ArkivBlockString, transactionHash? }
```

The parent private worker must hold a global writer-owner lease across processes and durably fence mapping updates. The function serializes the same owner within one process, verifies source evidence, queries exact owner+creator+event-version matches, compares the full payload and reuses/renews an existing entity before considering a create. It rejects conflicting payloads, foreign metadata and pending owner transactions. A consistent salt is not a uniqueness constraint because entity keys include a nonce.

Create/renew waits have a 45-second total publication budget (configurable up to 60 seconds); RPC fetches and response bodies have absolute deadlines and a 2-MiB bound. Any ambiguous create result must be retried through query-first recovery, not by a second immediate broadcast. A worker lease should exceed the total budget with time for fenced persistence. Off-band operator publication requires exclusive use of that writer.

Retention is 90 days; renew at an estimated 14 days remaining. `expiresAt` is a **block height**, never a Unix timestamp. SDK `getBlockTiming()` supplies the current height/duration. Readonly creation prevents payload patching but does not prevent owner deletion or eventual expiry.

## Actual evidence and open gate

```powershell
node --import tsx packages/arkiv/scripts/public-read.ts
node --import tsx node_modules/vitest/vitest.mjs run packages/arkiv/test
```

[The actual public read](evidence/public-read.json) used SDK 1.0.1 on Rabdi 7794095 and returned zero receipts for configured writer `0xAB5C7220E7d98D57181346d00D6E7957f42Af486`. That writer still has zero tGLM. Funding was explicitly deferred, so no signed receipt write, entity key, extension or live refund/accounting proof is claimed. Unit tests use clearly synthetic source events and writer operations; they establish behavior, not live Arkiv execution.

See [the schema/ownership/license policy](../../arkiv/schema.md) and [accountant setup](../../apps/accountant/README.md).
