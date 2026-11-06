# Third-party software and assets

SettleKit uses pinned open-source dependencies through `pnpm-lock.yaml`; dependency source and license notices remain with their packages. Principal libraries include Next.js/React, TypeScript, Tailwind, Lucide, wagmi/viem, TanStack Query, Drizzle/node-postgres, fast-xml-parser, Vitest/Playwright, Hardhat/OpenZeppelin and the official Arkiv/Chainlink SDKs. These libraries do not audit or endorse SettleKit.

Manrope variable font is sourced from the official [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/manrope). Its SIL Open Font License is included at `apps/gateway/public/fonts/OFL-Manrope.txt`. The SettleKit interface/source was authored for this project rather than copied from a sponsor sample app. Sponsor documentation/templates were consulted; the isolated contract smoke is deliberately labeled a toolchain spike.

The OFAC importer reads the official published list. Its minimal provenance summary is public evidence; raw datasets and private decisions remain outside committed logs and Arkiv. Provider/list coverage limitations are stated in the screening documentation.
