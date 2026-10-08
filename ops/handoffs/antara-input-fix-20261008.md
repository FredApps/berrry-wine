# Antara generic client mouse coordinates

Task `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`, worker `antara-input-fix`.
Isolated `/home/user/wt-antara-callback-20261007`, branch
`findings/antara-input-fix-20261008`, base `8dcc23ef7`. Prior branch preserved;
shared root HEAD/index untouched. DLL path repair `dad1f8c78` was already main.

`lib/renderer-input.js` now uses client coordinates for captioned popups,
including capture fallback and cached releases. Published USER geometry takes
precedence over the bootstrap region shortcut. Deep child delivery also uses
the target's client origin, matching capture and MSG.pt; the existing window
fallback remains available before the exports bind. Whole-surface regions and
borderless popup/menu clients retain coincident client/window origins.

`src/10-helpers.wat` mouse-origin helpers use the target client origin rather
than choosing window origin for every popup. MSG.pt converts client mouse
lParams back to screen coordinates; screen-space hit-test, non-client and wheel
messages retain their screen coordinates rather than adding the origin twice.
No painting/sizing or game-specific offsets changed.

Evidence is `/home/user/wine-assembly/scratch/runs/20261008-antara-client-origin-fix`.
The added renderer regression reproduces the original DOWN `00a7019b` rather
than expected `00900198`. A compiled negative control using the original HEAD
helper fails at origin `[0,0]` rather than `[3,23]`. Fixed tests cover the actual
captioned popup geometry, bootstrap/exported/region routing, press/move/release,
real USER SetCapture/ReleaseCapture, MSG.pt, signed child client coordinates,
owned popup geometry, borderless popup and menu surfaces. Existing region
move/resize, child Z-order, AdjustWindowRect roundtrip, native menu (14 checks),
dialog modal and dialog caption/child routing tests pass. A requested optional
worker-menu test is absent in this checkout; its failed invocation is retained
and is not counted as a pass.

The initial canonical `bash tools/build.sh` stopped at a preexisting gate:
`test/test-toyvm-paging.js: 0 -> 2 raw region literal(s)`, already in base HEAD.
No unrelated file was modified by this worker. A separately logged run excluding only that
failing gate passes all remaining mandatory gates and the WATX compile:
module SHA-256 `4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`,
1,721,405 bytes. That partial run alone was not a full-build pass.

Root subsequently supplied `7b9f0c344` (own cherry-pick `f62ab3c9f`), naming
the independent ToyVM guest page directory without changing fixture bytes.
The previously failing `node tools/region-census.js --gate` now passes. A full
canonical rerun resumed at 00:17:29 after root recovery, passing preflight
at 2,877,009,920 bytes free with actual CLI/build absence. **Full canonical
build passes**, all mandatory gates, WATX compilation and data-overlap checks;
module hash is unchanged. Root's ToyVM paging fixture regression also passes
all four variants. Local native ownership released after both completed,
2,918,694,912 bytes free. Earlier failed and partial-build logs remain evidence.

Local native slot claimed once at 00:12:11 with 2,834,591,744 bytes free and
actual CLI/build absence; released 00:14:22 after sequential tests/build.
Fixture calc.exe is an ignored symlink to the shared original fixture.
Original-media ordinary installation preparation reuses the predecessor
503-pin harness/media package but regenerate every source/module pin from
this committed worktree, retaining the original Worker and private registration.
No remote transfer/browser has been started; Tiberian owns the global browser
slot. Root granted Antara the next slot at 00:18:31, conditional on actual
Tiberian release and independent PID/socket/TTL/free-space checks.

Preparation is now complete in the same evidence folder: `READY.json` records
candidate `f62ab3c9f1223ab47cf623470f6343d508257878`, module hash above,
503 pins (451 source, 42 original fixtures, 10 harness files), archive
`8007a9b5a3f1fb05a9ef8b861994ffeb936fdd1542688e2241c591d878420031`,
42,321,442 bytes. Runtime source and module are rebuilt from this worktree;
the raw unmodified registry is also archived, while the served registry adds
the unchanged predecessor private registration. Source icons excluded by
sparse checkout were restored before final preparation. Real HTTP tests check
all source/alias HEADs and module/Worker/renderer/registry/original SETUP GET
hashes, with no pending streams. All 503 archive members were also rehashed
against the transfer manifest. The existing bounded pointer observer's
forward-once/restore/no-export tests pass. No remote authorization file exists.

Full canonical build passes and the queued grant is recorded. After Tiberian release,
write a fresh scoped `remote-authorization.json` only after independently
checking predecessor PIDs, Chrome/listeners, TTL and free space. Then run
`node /home/user/wine-assembly/scratch/runs/20261008-antara-client-origin-fix/transfer.js`
and `node /home/user/wine-assembly/scratch/runs/20261008-antara-client-origin-fix/control.js launch`.
Controls use remote prefix `/home/user/antara-client-origin-20261008` and
Puppeteer `/home/user/q2-tools-20261008/node_modules`. Transfer remains bounded
to 240 seconds; browser deadline is 120 seconds, followed by cleanup reserve.
Read the sandbox skill before remote work. Inspect each actual scene before
click/key commands, using the driver's existing scene receipt validation.

## Ordinary attempt completed; next blocker

The queued grant was consumed after independent actual Tiberian driver34328/
Chrome34340 absence, no Chrome, baseline sockets, 49.67 GB free and expiry
00:36:50 preflight. Lease claimed 00:23:35 on `bx_624jbk9k`; transfer verifies
all503 pins at 00:24:55, original browser driver42599/Chrome42621 starts
00:24:59.026 with deadline00:26:59.100. No Worker overlay, guest edit, CPU
export or return override is used.

Current visible Main Menu is centered at window `(320,240)`, client `(323,263)`.
The reviewed visible Install click `(731,408)` queues correct screen hit-test
`019802db` and correct client DOWN `00910198` / `(408,145)`. Four normal
menu PNGs are identical (`ee3a3900524db99734c11df499ccab5c33affa193aacc5f461ae0cfd2396fb32`).
No installation advance or gameplay occurs. Actual guest callback handling is
unmeasured; the fixed producer contract does not establish guest consumption.
Do not guess another coordinate fix. A fresh continuation should measure owning
guest callback/Win16 translation/application handling, retaining original media
and no forced guest state. The page coordinate diagnosis is settled.

Actual ordinary quit completes 00:26:12.551, browser/serverclosed/Chromeexit0,
errors0/streams0. Independent 00:26:51 actual PIDs absent, no Chrome, exact
socket baseline, all503 postrun pins unchanged. Sole remote lease released
00:27:10; owned prefix removed00:27:41 after all22 diagnostic copies and full
runtime archive verify. Other prefixes, Puppeteer and root box lifecycle stay
untouched; no native/browser job remains.

Self-contained ordinary evidence:
`/home/user/wine-assembly/scratch/runs/20261008T002459Z-antara-client-origin-install`.
It includes original full503-pin runtime/source/module archive, raw captures/
inputs/asset responses, build/tests/negative controls, actual preflight and
cleanup/removal receipts. Regression preparation remains separately available.
Sourcefix2074 was integrated by root; docs-only updates follow for integration.

Installation and player-controlled gameplay remain unqualified. The prior
ordinary menu click only measured the host packet; actual Antara guest callback
consumption remains unmeasured. Next run must use this matching source/module,
click the visible original Install control, inspect each resulting scene and
continue ordinary installation. Do not force controls, patch guest state, run
a shadow CPU, or treat menu artwork as gameplay.
