# Independent SettleKit accountant

A separate Next.js service, default `http://127.0.0.1:3400`. Its browser talks directly to public Arkiv and Whitechain RPCs through `@settlekit/arkiv`; it never reads gateway history or Neon and needs no private browser credential. The graphite/mint surface includes actual merchant/kind/UTC-date/block filters, keyset pagination, verification details, exact available-record totals, CSV and bounded source-range reconciliation.

From this directory after the pinned workspace install:

```powershell
node node_modules/next/dist/bin/next build
node --env-file=../../.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3400
```

Open `/?merchant=<publicSettlementWallet>` to preset the wallet. Other filters are entered in the visible form. Public deployment metadata uses `WHITECHAIN_ROUTER_ADDRESS`, `WHITECHAIN_ROUTER_CODE_HASH`, `WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK` and optional `ARKIV_PUBLIC_WRITER_ADDRESS`. The page whitelists only these public facts. It deliberately uses the official credential-free public RPC URLs; operator RPC URLs, `ARKIV_ACCESS_KEY`, writer keys and database URLs are never passed to browser props.

The configured default writer/merchant are the existing public test-role addresses. No receipt is fabricated when the writer has no funded writes. Without a verified public router configuration, the UI still performs the real Arkiv query and explicitly disables history reconciliation. Zero returned rows mean no available matching entities, not that no money moved.

Totals describe **loaded available verified activity in the selected scope**, not a merchant wallet balance or complete all-time history. Payment/refund sums are exact integers; correction records contribute zero. Load remaining Arkiv pages and scan the complete stated source range before treating its coverage as reconciled. The viewer stops after bounded scan batches and supports continuation; reorg/anchor changes require a new consistent scan. Soft two-block inclusion is labeled separately from finality.

Source/provider errors, rejected and expired records, query/verification progress, partial range coverage, missing/unavailable receipts and the empty state are explicit. Exports contain verified deduplicated public facts only, with formula-safe text cells. Entity/source explorer links point to public evidence. Ownership and expiry do not guarantee completeness or permanent availability.

The actual public SDK evidence is [public-read.json](../../packages/arkiv/evidence/public-read.json). Signed writes and real 25/5/20 live payment/refund accounting remain user-deferred funding gates. Populated unit/browser fixtures, when used, are documented as fixtures and are never presented as live history.
