# How SettleKit uses Arkiv

The accountant filters public receipt entities by merchant, kind, UTC source date and source-block range. Typed SDK queries restrict both current owner and immutable creator to the configured writer, and page by immutable entity key. These are real queries against Rabdi, not requests to the gateway's PostgreSQL history API.

Every loaded record is checked against Whitechain: exact chain/router runtime hash/token, successful receipt, event parameters, block identity, timestamp and the stated soft confirmation stage. Only verified logical payment/refund events enter totals. Duplicate entity copies and zero-value corrections cannot increase money. Range reconciliation separately scans bounded router logs and reports missing/unavailable records; querying Arkiv alone cannot detect omissions.

Ownership identifies the publisher the reader trusts. Readonly creation prevents accidental payload patching; source verification remains necessary because a trusted publisher can still be wrong. Expiry makes availability explicit, so the UI labels available verified activity and exposes source-range gaps instead of calling the result a complete balance.

The current executable query is `node --import tsx packages/arkiv/scripts/public-read.ts`. The browser viewer runs independently on port 3400 and uses the same SDK/public RPC path without private credentials. Unit fixtures verify forged writers, changed source events, reorg/re-inclusion, duplicates, expiry, missing coverage and exact 25/5/20 arithmetic. Those fixtures do not establish a live receipt write. [Actual read evidence](../packages/arkiv/evidence/public-read.json) records zero returned entities; the signed-write gate remains open until funded.
