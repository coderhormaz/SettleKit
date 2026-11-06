# Phase 1 sponsor probes

These commands distinguish live reads, local compilation and real CLI simulation from signed testnet writes. Run from the repository root after the pinned workspace install:

```powershell
pnpm --filter @settlekit/feasibility wallets
pnpm --filter @settlekit/feasibility probe:whitechain
pnpm --filter @settlekit/feasibility probe:arkiv
pnpm --filter @settlekit/feasibility probe:arkiv-browser
pnpm --filter @settlekit/contracts smoke
pnpm --filter @settlekit/contracts compile
```

For optional private environment overrides, load the ignored root file explicitly rather than copying values into commands:

```powershell
pnpm exec tsx --env-file=.env packages/feasibility/src/arkiv.ts
```

`wallets` creates test-only roles in ignored `data/phase-1-wallets.json`, never overwrites an existing file, validates public/private key association and emits public addresses only. Do not use these keys for customer/mainnet funds or commit/import them into a browser bundle.

`probe:whitechain` verifies chain `1874`, the exact sponsor USDT contract/metadata, EIP-1967 implementation/admin slots and per-role balances. Its zero-amount `eth_call` checks are read-only simulations. They are not signed approvals/transfers and never satisfy a customer invoice. The user deferred funding, so real approval/transfer behavior remains pending.

`probe:arkiv` uses SDK `1.0.1` to execute a trusted-writer/schema query. When the writer balance is zero it records the funding blocker and exits `2`, without making up an entity key. When funded, it writes one deliberately harmless 1-day feasibility entity and queries it back. This is test evidence, not the payment/refund schema or long-term accounting retention. Use `ARKIV_WRITER_PRIVATE_KEY` and `ARKIV_ACCESS_KEY` only in ignored server configuration if supplied; otherwise the generated local writer is used.

`probe:arkiv-browser` requires a prior Arkiv probe and Playwright Chromium. It replays that exact public owner-filtered query from a separate local page directly to Rabdi. It needs neither gateway API nor private browser credential. An empty query proves public-browser reachability, not an owned write or complete records.

Local contract commands compile a tiny OpenZeppelin-compatible spike targeting `prague`; no router or testnet deployment is included. See [the CRE instructions](../cre/README.md) for the actual HTTP/RPC workflow simulation and its explicitly documented simulator bootstrap dependency.

Sanitized outcomes are under `docs/evidence/phase-1`. Transport error details are deliberately not dumped because provider errors can include credential-bearing URLs. No signed token transfer or Arkiv write has been claimed while their funding gates remain open.
