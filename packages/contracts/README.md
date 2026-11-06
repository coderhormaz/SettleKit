# Router

`SettleKitRouter` transfers exact integer USDT amounts directly from payer to merchant. It stores the original association and cumulative refund amount; refunds pull from that original merchant to that original payer. It never holds a gateway balance or forwards unsolicited transfers. This is testnet software; local tests use `MockUsdt` and do not prove sponsor payment requirements.

The immutable deployment has both payment and refund operations. EIP-712 domain `SettleKitRouter`, version `1`, includes the actual chain ID and router address. Payment and refund are separate typed structures. The browser-safe ABI/types live at `packages/core/src/router.ts`.

## Local checks

From the repository root:

```powershell
pnpm --filter @settlekit/contracts compile
pnpm --filter @settlekit/contracts test
```

Compiler: Solidity 0.8.38, optimizer 200 runs, explicit `prague`. Dependencies are pinned by the workspace lockfile. Hardhat's current viem/Node test runner executes actual local simulated EVM transactions. OpenZeppelin ECDSA emits compiler warnings about an identifier becoming a future keyword; compilation succeeds with the pinned compiler.

## Policy controls

The policy administrator is an Ownable2Step owner and is distinct from the authorization signer. Merchant sessions cannot call either operator role. The router begins with no valid policy and fails closed. `syncPolicy(nextEpoch, validUntil, commitment, wallets, blocked)` must strictly increase the epoch, use a nonzero commitment, expire within two hours, and update at most 512 explicit denials. Omitted addresses retain their prior denial. Clearing a denial requires an explicit false entry under a new operator policy; merchants cannot override it.

Pause and signer changes invalidate policy and every previous epoch; unpausing still requires a new confirmed sync. Operations reject denied payer/merchant, expired/unavailable policy, wrong epoch, an authorization deadline after policy expiry or over 120 seconds ahead, and a signature by any other signer. The service issues at most 60-second authorizations and must also bound them by current evidence expiry. A stopped operator cannot keep old authorizations executable after policy expiry. This does not guarantee instant discovery/synchronization of newly published source entries.

SafeERC20 checks transfer return behavior and a recipient balance-delta check rejects inexact/fee/no-op transfers. Effects and invoice/refund IDs roll back if a transfer fails. ReentrancyGuard protects both operations. A new payment uses a unique nonzero invoice ID, a refund uses a unique nonzero refund ID, and each refund is capped by remaining original value. Only the payer calls pay; only the original merchant calls refund.

## Whitechain deployment and source verification

Live deployment/payment remains pending test funding. No deployed address or payment hash is claimed by these files. Follow the [selected sponsor track](https://ethglobal.com/events/mumbai/prizes/whitechain) and [official deployment instructions](https://docs.whitechain.io/build/deploy/deploy-with-hardhat).

Store only throwaway test credentials in ignored `.env`: `WHITECHAIN_DEPLOYER_PRIVATE_KEY`, `POLICY_ADMIN_ADDRESS`, `AUTHORIZATION_SIGNER_ADDRESS`, and optionally `WHITECHAIN_RPC_URL`. Keep the policy-admin key separate from the authorization signing key. Run from the repository root after the local checks:

```powershell
pnpm exec tsx --env-file=.env packages/contracts/scripts/deploy-whitechain.ts
```

This default command only checks configuration/network/token and reports funding without broadcasting. Once authorized and funded, append `--broadcast`. It checks chain 1874 and the exact six-decimal sponsor token, saves actual receipt/compiler/constructor evidence, and leaves policy unavailable until a separate confirmed operator sync. Deployment output never implies source verification succeeded.

The Hardhat network and Blockscout descriptors use the current official template. From `packages/contracts`, verify the actual resulting address with its constructor arguments:

```powershell
pnpm exec hardhat verify --network whitechainSepolia ROUTER_ADDRESS 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 POLICY_ADMIN_ADDRESS AUTHORIZATION_SIGNER_ADDRESS
```

Check the explorer Contract tab/source verification result and record the real reference before changing `sourceVerified`. The actual main-flow USDT payment and explorer link are separate evidence gates. No mock token or zero-value `eth_call` fulfills them.
