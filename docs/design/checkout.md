# Checkout and payment operations

Mode: Operate. Routes `/checkout/[reference]` and `/payments`. Phase 2 extends the established graphite/mint system; it does not replace the visual world or alter global design tokens.

## Direction contract

THESIS: Make an exact, screened payment understandable before a wallet asks for a signature or transaction. The amount, business and settlement destination lead; wallet actions follow in a clear sequence.

OWN-WORLD: Inherit self-hosted Manrope, flat graphite layers, quiet borders, mint actions, tabular money and wrapping addresses from DESIGN.md. Semantic amber denotes a hold; mint success requires current server evidence. No fake balances, decorative charts, glass or gradients.

STORY: A buyer arrives from the merchant's store, verifies amount and payee, connects to Whitechain Sepolia, proves wallet ownership, passes required checks, approves only the exact necessary USDT allowance, and sends the bound router payment. Server-observed confirmation determines payment status; returning to the store never proves payment.

FIRST VIEWPORT: A compact brand/testnet header and quiet back link. A receipt summary presents the amount and business, with the full settlement wallet accessible. A separate task panel presents one current action, its purpose and the real network/gas/approval boundary. Mobile stacks summary before action without horizontal overflow.

PAYMENTS: A compact merchant header leads to a precise list of persisted payment records. Status, amount, confirmation and delivery remain distinct. Selection exposes actual payer, transaction and event/version details. Empty, expired-session and failed-read states are first-class; no future dashboard controls appear.

FINISH: Actual browser evidence at 390×844, 768×1024 and 1440×900, keyboard focus and error/pending/held states are required before declaring the UI verified. A build alone proves no payment.

## States and accessibility

- Initial loading, unknown/expired checkout, network failure with retry, missing wallet, wrong network, rejected proof/approval/payment, insufficient USDT or WBT, required screening hold, policy unavailable, approval pending, payment submitted/confirming, accepted and reorg/review.
- User text and identifiers wrap. Actions have visible names, loading labels, persistent errors and obvious focus. Status uses text and icon as well as color. Reduced motion follows the inherited global preference.
- Background polling cannot silently mark an accepted state when the current read fails. A pending transaction remains visible on page reload through server state; only canonical server observation resolves it.
- A submitted hint cannot hold an open checkout forever. Explicit retry first explains that the earlier transaction may still confirm and network fees may apply. A separate confirmation rechecks the current checkout, dismisses only the old hint (persisted locally), and requires fresh ownership/screening. The router's invoice uniqueness prevents a second successful charge; retry never claims the previous transaction failed or cancels it.
- Approval and payment are separate wallet actions. The wallet signature alone never moves funds. The exact amount is approved; changing the connected account invalidates the current authorization.
- Approved return URL comes from the server-created checkout; no arbitrary redirect query is used. The buyer can always leave without changing payment state.

## Verification

Implementation verified: 8 Playwright checks passed across setup/checkout/payments, mobile overflow fixed, responsive/keyboard and real wallet-proof separation checked. Checkout/payment state screenshots use explicit HTTP/RPC fixtures; actual store pending screenshots use matching running services and Neon. A fresh independent finish reviewer returned **ship**, all 14 captures valid and no material fixes. Keep funded Whitechain proof separate from these checks. This ordinary extension preserves DESIGN.md and its sidecar; detector advisories were reviewed at their scope rather than relabeled as zero findings.
