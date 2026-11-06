# CRE route feasibility

This is an actual CRE SDK workflow for **Phase 1 capability proof**, not the Phase 5 payment recovery implementation. It calls Whitechain JSON-RPC through the HTTP capability, validates the fixed chain/token metadata, then calls a separately served diagnostic merchant API. It does not authorize payments/refunds or claim a live DON execution.

Run from the repository root after the workspace installation:

```powershell
pnpm --filter @settlekit/cre diagnostic-api
```

In another terminal, use the verified local tools (or official installed equivalents):

```powershell
pnpm --filter @settlekit/feasibility wallets
pnpm --filter @settlekit/cre prepare-env
& '.tools/cre-1.39.0/cre_v1.39.0_windows_amd64.exe' login
Push-Location packages/cre
$env:PATH = (Resolve-Path '../../.tools/bun-1.4.4/bun-windows-x64').Path + ';' + $env:PATH
& '../../.tools/bun-1.4.4/bun-windows-x64/bun.exe' node_modules/@chainlink/cre-sdk/bin/cre-compile.ts main.ts ../../data/cre-phase-1.wasm
& '../../.tools/cre-1.39.0/cre_v1.39.0_windows_amd64.exe' workflow simulate . --project-root . --target staging-settings --non-interactive --trigger-index 0 --wasm ../../data/cre-phase-1.wasm --env ../../data/cre-simulation.env
Pop-Location
```

The current CLI requires interactive account login or a privately supplied `CRE_API_KEY`. Complete login yourself; do not paste keys into chat. If simulation requires `CRE_ETH_PRIVATE_KEY`, use a throwaway local test key in an ignored environment file. The simulator has no permission to broadcast: never add `--broadcast` to this route proof.

The local loopback diagnostic route is for CLI simulation only. A deployed workflow would require a reachable approved endpoint and its actual production capability/network checks. In Phase 5, the separate store API, current-state checks and authenticated idempotent recovery replace this diagnostic response.

CLI `1.39.0` requires one registered native RPC client before running even an HTTP-only workflow. `project.yaml` therefore includes the official tutorial's Ethereum Sepolia RPC **only as a simulator bootstrap dependency**. The workflow never invokes native EVM capabilities or broadcasts; its actual chain evidence comes from Whitechain HTTP RPC. Whitechain was absent from the tenant's supported-chain list. This does not establish native Whitechain CRE support or add another payment network.

Two current Windows/tooling constraints are explicit: CRE's command wrapper fails on this workspace's path with spaces, so compile through Bun directly and pass `--wasm`; CRE's validator requires the legacy TypeScript compiler API, so use the verified compatible `5.9.3` pin rather than the incompatible native TypeScript 7 package.

The official SDK's HTTP calls may execute repeatedly across nodes/runs. Cache settings are a best-effort optimization; the implemented recovery endpoint enforces durable idempotency independently.

## Phase 5 recovery implementation

`recovery.ts` is the separate real SDK workflow for payment recovery. It verifies canonical chain evidence, reads the independent merchant order API and fresh gateway eligibility, then submits a stable capped recovery round after consensus. The backend revalidates and schedules only the existing notification. Manual replay cannot receive its persisted CRE delivery attribution.

`pnpm cre:compile` compiles actual recovery WASM and has passed. `pnpm cre:recover` performs the real CLI simulation using private prepared configuration; it has **not** yet been run for recovery. Follow the [recovery runbook](../../docs/phases/phase-5-runbook.md). Latest test/runtime verification is deferred. No ordinary Node retry or Phase1 route simulation is described as recovered fulfillment or DON deployment.
