# ScummVM fullscreen GetCaps repair — private validation

Source commit f5bd44bc75af08a76c55643d1591e996b8b5c795 is based exactly on 24d5d399540a8cb4a9af4ab0de8a317f73ef63bf, preserving its live-button and Jig changes. Only src/09a8-handlers-directx.wat and new test/test-directdraw-getcaps-allocation.js changed.

The captured directx SDL mode switch returned NULL after GetCaps omitted VIDEOMEMORY from an actually video-backed surface. The repair returns authenticated allocation caps, with live-object/output mapping checks, a four-byte legacy DDSCAPS write and unchanged 12-byte cleanup. It does not universally add video-memory flags or extend Surface7 structures.

Actual-WASM before control fails the precise SDL caps assertion (0x840 versus 0x4040). Candidate passes real primary/back/offscreen default/video/system allocation, Surface2/3 invocation, GetSurfaceDesc parity, output sentinels and invalid/released objects. Existing surface-caps and backbuffer tests pass. New test is automatically classified unit by the tier rules.

Full production gates, shake placement, compile and segment-overlap checks passed privately in session 46621. Module b23cda63fbd286c88644bad859145a6f02b989c51b0c9566f5f0f0e2fbe1b38c, 1672099 bytes, layout 1e4e4968cf32db41. Canonical module unchanged. All test/build descendants closed and slot released.

Receipts: scratch/scummvm-av-20261003/getcaps-repair/{focused-validation.json,build-receipt.json,source-rebase-receipt.json,repair-commit.json}. Build receipt pins all 2568 source/test/tool files. Earlier missing private fonts and tracked ToyVM bundle logs remain as environment failures; neither required changing assertions. Final build log SHA256 248558ba5fa5c0a81c0aae2987072e66248337f65b4cb087167c24975cde4869.

Ordinary browser validation remains pending. Prepared getcaps-ordinary helper uses the private production module without diagnostic Worker or timer changes; one ordinary Alt+Enter must retain the live scene. Owner display state, window presentation, consent and browser fullscreen are separate observations. No fullscreen fix claim until that route succeeds.
