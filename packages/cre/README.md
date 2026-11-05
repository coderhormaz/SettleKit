# CRE route feasibility

This is an actual CRE SDK workflow for **Phase 1 capability proof**, not the Phase 5 payment recovery implementation. It calls Whitechain JSON-RPC through the HTTP capability, validates the fixed chain/token metadata, then calls a separately served diagnostic merchant API. It does not authorize payments/refunds or claim a live DON execution.

Run from the repository root after the workspace installation:

```powershell
pnpm --filter @settlekit/cre diagnostic-api
```

In another terminal, use the verified local tools (or official installed equivalents):

```powershell
$env:PATH = (Resolve-Path '.tools/bun-1.4.4/bun-windows-x64').Path + ';' + $env:PATH
& '.tools/cre-1.39.0/cre_v1.39.0_windows_amd64.exe' login
& '.tools/cre-1.39.0/cre_v1.39.0_windows_amd64.exe' workflow simulate . --project-root packages/cre --target staging-settings --non-interactive
```

The current CLI requires interactive account login or a privately supplied `CRE_API_KEY`. Complete login yourself; do not paste keys into chat. If simulation requires `CRE_ETH_PRIVATE_KEY`, use a throwaway local test key in an ignored environment file. The simulator has no permission to broadcast: never add `--broadcast` to this route proof.

The local loopback diagnostic route is for CLI simulation only. A deployed workflow would require a reachable approved endpoint and its actual production capability/network checks. In Phase 5, the separate store API, current-state checks and authenticated idempotent recovery replace this diagnostic response.

The official SDK's HTTP calls may execute repeatedly across nodes/runs. Cache settings are a best-effort optimization; our eventual recovery endpoint must enforce durable idempotency independently.
