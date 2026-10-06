# Icy Tower: counter proof plan, 2026-10-03

Status: gameplay FPS unknown. Source-only inspection; no runtime, benchmark, build, download, executable modification, or measurement publication.

## Verified identity and current evidence

- Registry: lib/apps.js icy_tower mounts test/binaries/candidates/icy-tower/installed/icytower13.exe plus its required local manifest.
- Exact EXE SHA-256: e139648070ec1de00c7cbb135db664dd725c1cdb6d2ecad3108b8b9f906cf4de, matching docs/re-notes/icy-tower.md.
- PE image base 0x400000; packed entry 0x4f5f10. UPX0 begins RVA0x1000, virtual size0xb0000, raw size0. UPX1 begins RVA0xb1000 and contains the compressed payload/bootstrap. Therefore disassembling presumed game addresses in UPX0 from the file cannot reveal the executed render loop.
- Packed import table contains LoadLibraryA/GetProcAddress/ExitProcess, DirectDrawCreate, DirectInputCreateA, DirectSoundCreate, BitBlt, pow, CoInitialize, GetDC and joyGetPosEx. This is not a verified unpacked import census and does not establish whether the active game uses Flip, Blt, Unlock, or GDI transfers.
- Existing evidence directory: scratch/gameplay-restored-batch3-20261003/icy_tower/. It has startup/title/start/right/jump PNGs, input log, geometry, launch identity, dependencies and cleanup receipt. Geometry is640x480; physical viewport1024x768. No raw callback log, loaded image bytes, resolved import map, or render-loop caller stacks are present there. The source route also exists in test/test-icy-tower-candidate.js, but its changed-pixel screenshot assertion is not frame-rate evidence.
- Launch identity names module3d374324cd29153dd9354b855c98f0c52b44b709facbb8d1b67941fd9f05dddf. This is launch-file provenance, not a new measured loaded-response receipt. Pending TrackMouseEvent rebuild must be treated as a distinct future qualification identity.

## Local unpacking search

command -v upx returned no executable. Filename searches found no UPX tool or Icy Tower unpacked EXE/memory dump in /usr/bin, /usr/local/bin, /home/user/.local, /opt, /tmp, repository tools, build, scratch, or the installed fixture. Only the original packed icytower13.exe and installer were found as executable candidates. This is a bounded local search, not a claim about every archive or unrelated system directory. No tool was installed or downloaded, and no original bytes were altered.

## Exact semantic gap

No complete-gameplay-render marker is yet supported by executed guest bytes. Counting the packed entry, timer ticks, inputs, changed screenshots, DirectDraw creation, or BitBlt imports would be unjustified. lib/host-imports.js default dx_trace kind5 announces DirectDraw presentation traffic; its optional trace wrapper describes kind6 as front/back DIB swap. Neither identifies the game's outer complete iteration. Palette changes or intermediate primary-surface transfers may also present. The GDI callback at _flushGdiSurfacePresentation measures a dirty-surface flush, not a complete game frame. Do not transplant DX-Ball's addresses, callsite contract or state enum.

## Bounded next diagnostic, after root releases the runtime slot

1. Run the unchanged pinned original EXE through the known ordinary Space/start, Right/move, Space/jump route. Pin actual loaded WASM and JS response bytes, original EXE bytes, mounted assets and instance identity. Retain temporal screenshots proving active tower gameplay; exclude title, pause, replay and death.
2. After unpacking, read guest image memory with existing guest_read8 exports, outside execution, recording per-page guest VA and hash, PE mapped base and origin instance. tools/bench-mixed-census.js provides an existing live-unpacked-byte read pattern; do not enable its unrelated instrumentation/build merely to dump bytes. Save image bytes and resolved IAT/import targets. Proposed new paths (not yet created): scratch/gameplay-icy-tower-counter-20261003/loaded-image.bin, loaded-image-map.json, resolved-imports.json.
3. Capture a bounded diagnostic of actual dx_trace kinds, successful canonical uploads and API/caller stack/return values for the selected live640x480 game window. Include all same-target submissions, surface generation, COM and front/back DIB identities, origin contexts and monotonic timestamps. Proposed missing outputs: callers.json, surface-events.json and loaded-identities.json in that directory. This diagnostic is not FPS and must not arm a guessed marker.
4. Disassemble the observed unpacked callers; identify the game-side outer render iteration, state predicate, all return/bypass/error paths, and the last completed transfer. Determine whether multiple Flip/Blt/Unlock/palette operations compose one iteration. Prove source success and actual transfer semantics, not merely that a callback fired. If that cannot establish a complete-render boundary, retain FPS unknown and report only explicitly named presentation/update diagnostics.
5. Only after source and independent review: pin mapped marker/callsite bytes; require exact originating-context marker-to-complete-submission grouping, stable live target, all expected transfers, no orphan competing uploads, correct return results and immutable start/stop enclosure. Reject partial edges; never trim denominator or recycle earlier diagnostic samples. Fresh predeclared active-game windows then need temporal scene review and actual elapsed wall time, with observer overhead disclosed. Physical/displayed FPS and p95 remain unknown unless separately established.

This plan leaves no guessed address or qualified counter. The original gameplay screenshots remain useful independent evidence while the missing unpacked source/caller proof is collected.
