# Whitechain feedback

Phase 1 observations, 6 November 2026. These are actual local/read-only integration results, not a submitted sponsor message.

- The public RPC returned chain `1874`; the exact track USDT returned `Tether USD`, `USDT` and six decimals. The deployed token address has 2,227 bytes of proxy runtime code. Zero-amount approval/transfer `eth_call` returned an encoded true value; this remains simulation, not a funded transaction.
- The current deployment guide's explicit `prague` target is useful. A local Solidity `0.8.38`/OpenZeppelin compilation spike succeeded with that target. It is not our payment router and was not deployed.
- The faucet presents GitHub authentication and requires an account at least 30 days old. The user has deferred test funding; all generated test-role balances were zero when probed. Signed approval/transfer behavior therefore remains an open gate.
- Explorer proxy metadata identifies an EIP-1967 implementation, but the queried proxy/implementation smart-contract API responses did not expose a verified ABI/source in this probe. We have not inferred all issuer powers, pause behavior or permit support from a few getters. A sponsor-provided canonical ABI and exact-token funding instructions would remove that uncertainty.

Reproduce with the scripts and sanitized JSON under `packages/feasibility` and `docs/evidence/phase-1`. No payment, refund, router deployment or prize qualification is claimed yet.

7 November update: the actual screened router and original-payer full/partial refund primitives now have26 historical local contract cases, and the complete separate-store payment/one-fulfillment path ran against local mock-token EVM plus real Neon/production HTTP. Dashboard/refund/accounting source is present. These are local implementation results; funded specified-USDT deployment/source verification/payment/refund remain open. Further tests are user-deferred. No sponsor message has been sent.
