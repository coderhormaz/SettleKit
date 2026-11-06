# Chainlink CRE feedback

Phase 1 observations, 6 November 2026. Actual tooling/configuration results only; no sponsor message has been sent.

- Official CRE Windows `1.39.0` was downloaded, matched against the release API SHA-256 digest and verified with a valid SmartContract Inc Authenticode signature. Bun `1.4.4` also matched its official release digest. The tools are local under ignored `.tools`, without changing the user's global PATH.
- User login resolved the original authentication blocker. Live workflow deployment access is disabled; the accepted hackathon route permits an actual successful CLI simulation.
- The tenant's real `workflow supported-chains` response did not list Whitechain. CLI `1.39.0` requires at least one resolved native chain client even for an HTTP-only workflow. An unknown Whitechain `rpcs` entry produced “no RPC URLs found” despite `--allow-unknown-chains`. The proof therefore documents a real Ethereum Sepolia RPC solely for simulator bootstrap; the workflow itself calls the fixed Whitechain HTTP RPC and a separate diagnostic merchant API, and performs no native EVM operation or broadcast.
- Automatic CLI compilation encountered a Windows path-with-spaces error (`C:\\Users\\Abdul` treated as a command). Invoking the SDK compiler entry point through Bun avoids that command-wrapper boundary.
- That compiler then exposed a TypeScript compatibility issue: the new native TypeScript `7.0.2` package does not supply the legacy `ts.ScriptTarget` compiler API expected by CRE's validator. The SDK's own development version is `5.9.3`; the working pin and final outcome are recorded in the feasibility evidence after verification.
- The POST guide's `cacheSettings.readFromCache` / `maxAgeMs` example is older than SDK `1.23.0` types, which expose `store` and protobuf-duration `maxAge`. Actual compilation caught the mismatch; this read-only route proof uses `store: false, maxAge: "0s"`. Durable recovery idempotency is still required independently of any HTTP cache.

The actual route simulation now passes with production simulation limits. It reads Whitechain chain/token metadata and the separate local diagnostic API; the log and hashes are in `docs/evidence/phase-1/cre-simulation.*`. A minimal official SDK runtime smoke also passed. Replacing the workflow's Zod 4 runtime schema with bounded primitive checks and using documented Buffer base64 encoding removed its earlier generic WASM “not a function” failure; no single cause is asserted beyond that verified working configuration.

This proves the Phase 1 HTTP/Whitechain and diagnostic API route in real local CRE simulation. It does not prove payment recovery, deployed DON execution, native Whitechain support or sponsor eligibility. Those remain separate requirements.
