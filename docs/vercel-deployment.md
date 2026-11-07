# Vercel gateway deployment

Public hosting was authorized on 7 November 2026, with the explicit address
https://settlekit-007.vercel.app/. The project is `settlekit-007` in
`hormazs-projects`, rooted at `apps/gateway`, with shared workspace sources included.
It uses Node 24, `corepack pnpm install --frozen-lockfile`, and
`corepack pnpm --filter @settlekit/gateway build`.

`APP_ORIGIN` must match the public address exactly for wallet-signature domains,
mutation origin checks and secure cookies. Local HTTP and development failure
injection are disabled. The pooled Neon runtime URL and existing data-encryption
key are encrypted server environment variables. Direct/admin/test database URLs,
wallet private keys, local state and credentials are excluded from deployment.
The gateway currently uses the existing development database; this is a testnet
application, not a production-money release.

The persistent worker, example merchant store, independent accountant application
and CRE workflow are separate processes and are not hosted by this gateway
deployment. No funded router deployment/payment/refund, Arkiv write or live
recovery proof is established by web hosting. Required screening still fails
closed when source refresh is unavailable or stale.

To deploy updates from the repository root using an authenticated Vercel CLI:

```powershell
npx vercel@latest link --project settlekit-007 --scope hormazs-projects -y
npx vercel@latest deploy --prod --scope hormazs-projects -y --no-wait
```

Inspect the returned deployment with `vercel inspect <url> --logs`. A queued
deployment is not evidence of a successful build or assigned alias. Git integration
has not been enabled; GitHub pushes alone do not deploy this project.
