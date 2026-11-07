# SettleKit social launch cut

`brag.mp4` is a 20-second 1920×1080, 30 fps launch video with original instrumental music. `brag.jpg` is its settled poster, also baked into frame zero without extending the timeline. `share-copy.txt` is ready to post. The creative angle: receiving an onchain payment is only the beginning of completing an order.

The video reuses the running app's real rendered checkout, payment, webhook-delivery and reports markup, compiled CSS, Manrope font and Lucide icons. Fictional Fieldwork UI fixtures are injected only in the capture browser; every product scene is labelled. Captures block external requests, intercept all application API requests and perform no database writes or wallet transactions. Visible wallets are replaced with demo labels; inert snapshots contain no scripts or navigation URLs.

This is an illustrative social cut. It does not constitute funded Whitechain execution, signed Arkiv receipts, a deployed DON run, merchant validation, publication or the separately required human-narrated 2–4 minute demonstration. Those project evidence gates remain open.

## Rebuild

Run from the repository root with the existing installed project dependencies and Python packages (NumPy/SciPy). No additional installation is required on this workstation. `captures.json` preserves the sanitized source DOM for reproducing the same cut offline.

```powershell
# Optional: refresh real UI fixtures with the local gateway already running.
node brag-output/work/capture.mjs

node brag-output/work/build.mjs
python brag-output/work/music.py
node brag-output/work/render.mjs
# Review work/stills before the full render.
node brag-output/work/render.mjs --render
node brag-output/work/native-encode.mjs
node brag-output/work/validate.mjs
python brag-output/work/quality.py
```

The renderer samples the DOM as a pure function of time at exactly 600 timestamps, waits for all fonts/iframes, saves every JPEG frame and creates an intermediate silent VP9 WebM using Playwright's bundled FFmpeg. Chromium WebCodecs encodes the frames and stereo PCM into H.264/AAC; the original `mp4.mjs` writer supplies exact sample timing and fast-start MP4 packaging. The frame-zero poster replaces one frame rather than adding one. All raw intermediates, rejected encoding experiments and local logs stay under `work/` and are excluded from Git.

## Validation and attribution

Review `work/media-check.json`, `work/render-check.json`, `work/music-check.json` and `work/final-qa.json` for exact checks. Validation decodes samples from every scene and checks dimensions, duration, sample count/rate, audio/video codecs, audible unclipped stereo, fast-start metadata and absence of local personal identifiers. Source stills and mid-transition frames are inspected before rendering.

The Impeccable detector's fixed-size chrome padding warnings were visually reviewed: the 45-pixel chrome bar vertically centers 15-pixel text with clear space above/below. Large film typography intentionally differs from the app's operating UI type ramp. Application UI and its design system were not modified.

Music is an original seeded C-sharp-minor composition at 120 BPM, synthesized by `music.py`, with no borrowed recording or generated voice. Manrope is redistributed under the SIL Open Font License in `work/OFL-Manrope.txt`. Product components and Lucide icons retain the repository's existing license/third-party notices. Codex assisted with the creative plan, motion, original music, authoring scripts and verification.
