# Release checklist

Updated7November2026. All phases are authorized; main-agent-only testing resumed. Checked items are actual local verification, not funded live sponsor proof. See [verification record](evidence/phase-6/verification.json) and [six-phase audit](IMPLEMENTATION_AUDIT.md).

- [x] Current root suite:114/114 tests across13files,266.37seconds. Real isolated Neon plus explicit HTTP/RPC/source fixtures.
- [x] Router:26 local EVM contract tests. Python:7 standard-library security/HTTP checks.
- [x] Chromium:16/16 cases, including actual signed wallet login and Neon CRUD, public checkout creation, scoped key denial/revoke, signed endpoint test, CSV and cleanup. Other wallet/HTTP/RPC interface fixtures are labeled.
- [x] TypeScript, both Next production builds and actual Arkiv/CRE SDK imports pass. Actual CRE WASM compiles and CLI simulation executes.
- [x] Migrations0000–0008 and store001–002 applied to isolated test/development targets with limited pooled runtime roles. Fresh frozen install/build/unit/contracts are also exercised by GitHub CI; no live credentials are in CI.
- [x] Full local EDR/mock-token + production HTTP/real Neon sequence: store payment, controlled notification failure, actual CRE recovery, one fulfillment,5USDT original-payer refund,25/5/20 reports/verifier/CSV, no-adapter link/invoice payments, pause/deactivation and duplicate effects.
- [x] JS client/order/HMAC/durable callback and actual Python public service execute against the independent Node/Neon store. Python guards cover raw HMAC, strict money/chain types, version/refund/expiry, private DNS, redirects/response limits and malformed/test callbacks.
- [x] Auth/tenant/idempotency/nonce/refund-reservation/cancel/version/reorg/source-policy/recovery-cap/lease boundaries are covered by root/contract tests. Recovery duplicate evidence is validated before acknowledgment; broken checked-out clients are discarded without replaying an ambiguous commit.
- [x] Projection replacement-time repair, immutable source versions, source failure/canonical skip and occupied writer lease are exercised with actual Neon and explicit RPC fixtures. Live signed publication/renewal remains below.
- [x] Desktop1440×900/tablet768×1024/mobile390×844 captures inspected; keyboard/native-dialog/focus/reduced-motion checks pass. Impeccable source scan has0 primary findings and201 palette/type/radius inventory advisories; advisories are not hidden or represented as zero findings.
- [x] Supervisor duplicate-start/owned graceful-stop/occupied-port refusal checks pass. Actual independent accountant queries public Arkiv at all three sizes with gateway3000closed and no private API requests; returns0entities.
- [x] Actual PostgreSQL17.11 gateway/store dumps restored transactionally into separate isolated named databases. Gateway32tables/9migrations; store4tables/4orders/0receipts. Six unsafe-target/checksum/isolation/occupied-target checks pass; existing runtime URLs unchanged and TLS verify-full retained.
- [x] README sponsor rationale/configured writer/runnable public query, attribution/AI notes, honest integration inventory, operator/recovery/demo runbooks and feedback files updated. Hands-on merchant integration time remains unmeasured.
- [ ] Funded Whitechain1874 source-verified router/policy deployment,25 specified-USDT payment and5 original-payer refund; genuine explorer references. Latest read-only role balances remain0.
- [ ] Actual signed Rabdi payment/refund/correction entities and renewal/repair proof; positive gateway-stopped independent25/5/20 accounting and source-range coverage. Latest writer balance0/empty query.
- [ ] Repeat actual CRE recovery using the funded Whitechain payment. Current actual CLI proof uses the local EVM/mock token; no DON deployment claim.
- [ ] Human/team narration and final2–4minute video. Real merchant feedback/integration-time measurement remain unmeasured. Public hosting/submission/customer funds/sponsor messages require applicable authorization.

Reproduce independent suites sequentially because database/browser/integrated suites temporarily replace the isolated test screening source:

```powershell
pnpm test
pnpm test:contracts
python -m unittest discover -s examples/python -p 'test_*.py'
pnpm test:browser
node --env-file=.env --import tsx packages/contracts/scripts/local-payment-flow.ts --refunds --collections --recovery --python
pnpm typecheck
pnpm build:all
pnpm check:imports
pnpm audit:secrets
```

The public verifier in the local combined harness wraps real local chain payloads in explicitly synthetic Arkiv entity metadata; it does not execute an Arkiv write. Earlier failed attempts and fixes are described in the audit. Keep that distinction when recording demos or reading local transaction hashes.
