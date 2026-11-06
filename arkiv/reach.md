# Who this serves

The intended users are small merchants accepting direct-settled USDT and the accountant or operator reconciling their payments and refunds. The independent view is useful when they want to compare available public evidence with source-chain events without sharing a dashboard login or private customer records.

The repository contains a runnable separate store and accountant service. Local public SDK reads work today; no real customer adoption, merchant validation, public hosted app, signed Arkiv receipt or market-demand metric has been established. Test funding and the remaining live evidence gates are explicitly pending.

The user instructed us to complete the full six-phase scope beyond the event deadline if needed. That is an implementation instruction, not an externally promised maintenance schedule or evidence of future users. Reproducible local setup and limitations are documented in [the accountant guide](../apps/accountant/README.md) and [public package guide](../packages/arkiv/README.md).
