# Public receipt schema

Selected track: [Build on Arkiv, from scratch](https://ethglobal.com/events/mumbai/prizes/arkiv). Implementation: [public schema](../packages/arkiv/src/schema.ts), [queries](../packages/arkiv/src/query.ts), [server writer](../packages/arkiv/src/server.ts), and [independent accountant](../apps/accountant/).

`settlekit.receipt.v1` contains only project-produced public settlement evidence: schema version, opaque source-event version ID, payment/refund/correction kind, Whitechain chain ID, router/token, invoice/refund identifiers already emitted by the contract, payer/merchant, exact integer base units, transaction/log/block evidence and source timestamp. It excludes order numbers, contacts, invoice contents, risk decisions, secrets and provider dossiers. These SettleKit-produced public records are released under the repository's [MIT license](../LICENSE).

| Field | SDK type | Indexed | Purpose |
| --- | --- | --- | --- |
| schemaVersion | i32 | No | Version 1 |
| eventId | key | Yes | Version identity: hash of chain/router/tx/log/kind/block hash |
| kind | str | Yes | Payment, refund or correction |
| chainId | i32 | Yes | Fixed Whitechain 1874 |
| router | addr | Yes | Configured source router |
| token | addr | No | Exact sponsor USDT |
| invoiceId / optional refundId | key | No | Public event association |
| payer / merchant | addr | Merchant only | Parties actually emitted by the router |
| amountBaseUnits | u256 | No | Positive payment/refund amount; zero for correction |
| txHash / logIndex | key / i32 | No | Source event location |
| blockNumber / blockHash | u64 / key | Number only | Source range and canonical evidence |
| sourceTimestamp | u64 | Yes | UTC date filtering |

The configured gateway writer owns and creates the entities; ownership is not transferred to merchants. Both creator and owner must match the trusted public writer. Creation sets the SDK's readonly flag; the owner can still delete, and expiry can remove availability. No claim of immutability, perpetual history or privacy through expiry is made.

Initial retention is **90 days**, renewed when estimated remaining life is at most **14 days**. SDK `expiresAt` is an Arkiv **block height**, preserved as an integer string in private mappings. Timing reads convert the threshold using the actual block duration. This is an explicit availability policy, not a promise to renew forever.

A successful write followed by a failed private mapping commit is recovered through an exact owner/creator/event-version query and full payload comparison before another create. The parent worker serializes the writer across processes. A consistent salt is additional hygiene; entity keys also include a nonce, so salt alone does not establish idempotency. Pending owner transactions and ambiguous results pause blind creates. Read-side logical deduplication occurs only after source verification, so an expired/orphaned version cannot hide a canonical re-inclusion.

Actual public SDK query evidence is [public-read.json](../packages/arkiv/evidence/public-read.json). Configured test writer: `0xAB5C7220E7d98D57181346d00D6E7957f42Af486`. It currently has zero tGLM, **no successful signed receipt write or entity key is claimed**, and funding remains user-deferred.
