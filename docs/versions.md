# Phase 1 toolchain

Updated 6 November 2026 (IST). Exact dependency resolutions are in `pnpm-lock.yaml`.

| Component | Installed pin / observed result |
| --- | --- |
| Runtime | System Node 22.14.0; pnpm's bundled runtime reports Node 24.22.1. Supported LTS engine ranges are explicit. |
| pnpm | 11.25.0; current `allowBuilds.esbuild: true` after reviewing the required installer. Legacy onlyBuiltDependencies was removed by the official approval command. |
| Next / React | 16.4.5 / 19.3.1; production build passed. |
| TypeScript | **5.9.3**. Candidate 7.0.2 passed early typing but broke the actual CRE SDK compiler (`ts.ScriptTarget` unavailable). The working compiler API pin also satisfies wagmi's peer requirement. |
| Node typings | 22.20.5, aligned to supported application Node APIs. |
| Database | PostgreSQL 17 on Neon; Drizzle 0.45.4 / Kit 0.31.11 / pg 8.23.1; actual separate development/test migrations and integration tests. |
| Wallets / UI | viem 2.57.16; wagmi 3.7.11; Query 5.106.1; Tailwind 4.3.4; Lucide 1.69.0. |
| Screening | fast-xml-parser 5.12.0; unsafe declarations rejected before parsing. |
| Checks | Vitest 5.1.0; Playwright 1.65.0, Chromium 1254 installed. |
| Arkiv | SDK 1.0.1: real network query succeeds; write remains unfunded. |
| CRE | SDK 1.23.0, CLI 1.39.0, Bun 1.4.4; verified binary checksums/CLI Authenticode, authenticated account; simulation result is recorded separately, not inferred from compilation. |
| Contracts | Hardhat 3.21.2 / viem toolbox 5.0.7 / solc 0.8.38 / OpenZeppelin 5.6.1; smoke compiles for prague. No router or deployment yet. |

The release-age exceptions in workspace configuration name only the inspected pinned UI/test releases encountered by pnpm's policy. Do not globally disable package checks or approve unrelated build scripts. CRE is separately compiled with Bun/WASM; it does not use ordinary application networking or imply native Whitechain support.
