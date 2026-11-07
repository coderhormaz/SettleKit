# SettleKit launch cut

20 seconds · 1920 × 1080 · 30 fps · polished, precise, quietly punchy.

## The idea

SettleKit is a USDT payment gateway for small businesses: hosted checkout, direct settlement, merchant operations, original-payer refunds and recovery of missed store notifications. The hook is the gap between receiving a payment and completing the order. Show that gap, then the actual product that handles the work after payment.

Audience: developers and small digital businesses already serving stablecoin users. Distinction: order-bound payment evidence, mandatory configured wallet checks, retry-safe fulfillment, merchant-authorized refunds and independently verifiable accounting. No invented adoption, speed, savings or security claims.

Visual hook: a large typographic question beside the app's actual Received / failed-notification states. The reveal uses the real checkout, then the real reports and webhook delivery components. Reuse the app's rendered DOM, compiled CSS, Manrope font and Lucide icons. Animate DOM elements, rather than pan over screenshots. Graphite #0b0d11; work surface #12151c; mint #a3f5c5; foreground #f5f7fa; amber #f5cf8e for failures. Restrained movement, ample space, readable amounts.

## Truth and privacy

- Source: current repository and its running local gateway; capture requests are intercepted in the browser with explicitly fictional Fieldwork demo records. No changes to merchant databases, wallet transactions or sponsor services.
- Every product scene carries a readable `Local demo · UI fixtures` disclosure. These visuals illustrate implemented behavior; they are not new live execution evidence.
- The 25 / 5 / 20 example is supported by the documented local mock-token EVM + HTTP + isolated Neon harness. It is not a funded Whitechain transaction or a signed Arkiv receipt.
- CRE recovery is described as local simulation. Existing project evidence records a real local CRE CLI recovery and one fulfillment; the video does not claim a new workflow run or DON deployment.
- Use fictional business/order labels. Mask wallet values, remove transaction hashes and strip all navigation URLs from inert captured UI. No private names, contact records, cookies, keys, credentials or internal URLs in the video.
- The CTA is the authorized public source repository. No public app deployment, submission, merchant validation or prize eligibility is claimed. This social cut does not replace the separately required human-narrated 2–4 minute demo.

## Storyboard and beat grid

Original instrumental: 120 BPM, 4/4, C-sharp minor, 40 beats / 10 bars. Dry soft kick, low synth bass, restrained closed hats, a warm plucked motif and quiet harmonic transition accents. All events use one sample-based beat grid. No voiceover or borrowed music. Peaks kept below clipping; short fades on both ends.

| Time | Beats | Picture and action | Settled copy |
| --- | --- | --- | --- |
| 0–3 s | 0–6 | Brand mark; actual Received / failed-notification row excerpt. Question arrives in two deliberate lines. | Paid onchain. / Order still pending? |
| 3–7 s | 6–14 | Reveal the real accepted-payment checkout component, with its separate pending store-notification state. A controlled cursor draws attention to that distinction; no wallet transaction is simulated. | USDT checkout. / For your store. / Mandatory wallet checks |
| 7–12 s | 14–24 | Actual failed notification row changes to the real delivered / CRE recovery state. Three concise workflow steps explain receipt, order/current-state check, and retry. | Missed webhook? / Recover the order. / CRE recovery · local simulation |
| 12–16 s | 24–32 | Actual reports panel with 25 USDT received, 5 refunded, 20 net. The three real definition-list rows receive sequential emphasis. | Payments. Refunds. / One workspace. |
| 16–20 s | 32–40 | SettleKit wordmark, concise product promise and repository CTA. Quiet technology credits below. | USDT in. Orders moving. / Explore the code / github.com/coderhormaz/SettleKit |

Each scene settles within 0.35 seconds and holds its principal text for at least 0.3 seconds per word. Transitions dip through the base background; outgoing and incoming busy layouts do not overlap. Frame zero is replaced by the strongest settled poster frame, without extending the timeline or shifting sound.

## Build and QA

Use installed Node/Playwright Chromium for deterministic DOM rendering and native WebCodecs H.264/AAC encoding, Python/NumPy for the original stereo WAV, and Playwright's bundled FFmpeg for an intermediate VP9 preview. A small original ISO BMFF writer packages the native codec output with exact 30 fps timestamps and fast-start metadata. No dependency installation. Keep every script, capture, audio file and intermediate inside work/.

An initial installed-VLC encoding experiment failed timestamp/frame checks and was rejected. The browser-native one-second sample passes dimensions, frame count/rate, duration, codecs, sound and fast-start checks. Waveform correlation against the original soundtrack reports zero samples of offset. Failed experiments remain under work/ and are not delivered as the final clip.

Inspect a settled frame from every scene and mid-transition frames before rendering all 600 frames. Check clipping, contrast, collisions, font readiness, source fidelity and fixture labels. Validate final MP4 dimensions, duration, audio/video codecs, peak level, frame-zero poster and decode samples. Deliver brag.mp4, brag.jpg and share-copy.txt.

One-line caption: A stablecoin payment is only the start. SettleKit connects USDT checkout to the order, the refund and the recovery.
