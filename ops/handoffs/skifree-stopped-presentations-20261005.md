# SkiFree: accepted stopped-scene presentation measurement

On 2026-10-05, attempt5 measured **72 successful coalesced selected-window-subtree compositions over 5.00329 seconds: 14.3905 presentations/s**. Root and worker reviewed the endpoint images: both show **925 m and 0 m/s**. This is a stopped/crash-recovery scene, not continuous downhill performance or a demonstrated steering response. Physical-display FPS remains null.

The earlier automatic ArrowDown start produced an independently reviewed downhill image at 18 m / 22 m/s. That image does not describe the later sample. ArrowRight was held for 150 ms during measurement; its input-log timestamp is measurement completion, not a precise keydown timestamp. Animation changes do not establish downhill movement.

## Evidence and identity

- Dashboard run: `scratch/runs/20261005-ski32-stopped-window-presentations/result.json` (published last; no newly qualified gameplay screenshots).
- Durable raw receipts and three images: `ops/release-evidence/skifree-stopped-presentations-20261005/`; `artifact-hashes.json` covers 21 artifacts. The manifest itself is additional.
- Original immutable run: `scratch/skifree-presentation-20261005/attempt5`.
- Source: `f5bd44bc75af08a76c55643d1591e996b8b5c795`; full-gated module SHA-256 `b23cda63fbd286c88644bad859145a6f02b989c51b0c9566f5f0f0e2fbe1b38c`.
- Actual served provenance: 100 response receipts verified, zero byte/hash mismatches. Three aborted auxiliary build-info/stdole2 requests remain recorded without a causal claim.
- Driver `e212b4b7`, page `e3d5452f`, observer `36481462`, inspect `83869c4f`, passive native metadata reader `58387b11`; full digests are preserved in the readiness/pins artifacts.

The live native proof associated root HWND 65537 and same-owner HUD 65538 with canonical surface 6356993, record address 128703744, backing 472907776, stride 3072 and 768×768 dimensions. The visible client rectangle was (132,24,760,740), fraction 1. Read-only ancestry/style/backing checks remained stable. Separate actual-WAT producer and rebind receipts establish why this HUD writes the root backing; the live observer does not call allocating descriptor helpers.

The counter counts successful normal-desktop compositions consuming new canonical generations. Root and shared HUD updates coalesce; HUD-only attribution is unavailable (`null`). It does not establish distinct content, simulation rate, tear-free pixels, SDL-frame identity, or physical scanout. Counter validity and scene validity are separate: the counter qualified, continuous-downhill coverage did not.

## Resource release

Session 38754 / driver 3215234 / Chrome 3215246 started at 20:39:14.910Z. Cleanup at 20:39:49.912Z closed browser/server/recorder with no errors; Chrome exited 0 with no signal and both PIDs were absent. Chrome stderr was bounded (587 bytes, no drops), with early-startup capture limitations retained. Final available disk space was 758,489,088 bytes. Daggerfall received the next runtime slot; this publication launches nothing.

## Next downhill validation (source-only plan, no runtime grant)

Use one ordinary command sequence: ArrowDown with robust finally-release immediately before the before-image, then the existing five-second sample and after-image. Preserve actual keydown/up timestamps. Avoid a human-review delay between restart/resume and sampling; review the exact before/after images retrospectively. Require an actual distance change and nonzero speed evidence to qualify the downhill scene, independently of all existing counter/topology guards. If stopped or ambiguous, retain the valid narrow counter (if any) with an unqualified downhill scene; do not retry automatically or infer motion from animation. No screenshot is taken inside the timed sample, and no host clock/guest-state override is introduced.
