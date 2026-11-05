# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-selected Next.js and Neon PostgreSQL. Retained components: React/TypeScript, Drizzle/pg, viem/wagmi, persistent Node worker, Hardhat/OpenZeppelin, official Arkiv SDK, real CRE SDK/CLI and Bun for CRE. The app/worker initially run locally; public app hosting is undecided. Wallet-signature merchant login was explicitly selected.

## Users

The accepted initial merchant is a small digital-service business with a single owner and a settlement wallet. It needs to connect stablecoin receipts to an existing store, operate payments/refunds and reconcile accounts. Buyers already hold stablecoins and use a connected EVM wallet. An independent accountant reads public verified settlement evidence. Team invitations/staff roles are outside the single-owner release.

## Product Purpose

Provide screened USDT checkout, direct merchant settlement, reliable signed notifications, merchant-authorized same-chain refunds and independently verifiable accounting. Recovery compares chain evidence, current eligibility and the external store's actual order state.

## Positioning

The product joins order-bound payment verification, mandatory time-scoped wallet screening, idempotent fulfillment/recovery and public accounting. It makes no claim to invent stablecoin payments or guarantee lawful funds.

## Operating Context

The merchant configures a wallet, profile and a small server adapter; infrastructure administration belongs to the platform. In this phase, the user confirmed wallet connection/signature first, then business setup. Wallet signatures establish identity/ownership; sending tokens requires separate transaction authorization in later phases. Local services still require internet access to Neon and live sponsor testnets.

## Capabilities and Constraints

- Whitechain Sepolia `1874`, specified six-decimal sponsor USDT, and original-payer same-token/same-chain refunds are fixed.
- Arkiv Rabdi is a public verified receipt projection, independent of private Neon state. No PII/secrets/risk dossiers are published.
- Real Chainlink CRE recovery is required; HTTP/RPC route and account access must be proven. Simulation and live deployment are distinct evidence.
- Screening is mandatory; blocked/stale/unavailable required data never silently passes. Merchant controls cannot bypass hard denials.
- No Arc, ENS, bridge, crosschain refund, swaps, subscriptions, fiat conversion or project token.
- Phase 1 ships identity/onboarding, screening/private-state foundations and feasibility proofs; payment/router/dashboard operating flows follow in their authorized phases.

## Brand Commitments

Working name SettleKit. The accepted handoff specifies a premium graphite/mint fintech identity, readable typography/tabular money, restrained motion, precise operational language and truthful data. No market-price decoration or fake balances. Future name/trademark availability has not been established.

## Evidence on Hand

The repository contains a researched specification, six-phase plan and verified Git checkpoints. Read-only network/token metadata probes are recorded. Application, contract, funded wallets, Arkiv writes and CRE execution have no passing implementation evidence at Phase 1 start. Never fabricate customer logos, payment metrics, deployed addresses or sponsor eligibility.

## Product Principles

- Money and business state are verified separately; redirects never prove payment.
- Keep merchant integration small and platform complexity private.
- Prefer explicit pending/review/unavailable states over optimistic claims.
- Preserve exact values, durable history and retry-safe business effects.
- Treat independent verifiability and private-data boundaries as visible product behavior.

## Accessibility & Inclusion

The accepted brief requires mobile/tablet/desktop layouts, keyboard operation, readable text/amounts, labeled fields, clear focus/error feedback and reduced motion. A buyer email/account is not required for simple checkout. No product-specific localization requirement has been supplied.
