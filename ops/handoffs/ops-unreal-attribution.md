# Unreal viewport submission attribution preparation

Owner/session: `/root/ops_review`, `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, 2026-10-02. Local static preparation complete. Only `scratch/ops-unreal-attribution-20261002` and this handoff were written. No original fixture change/copy, production change, build, guest execution, browser, network or runtime grant.

**The frozen WinDrv has two direct BitBlt callsites with distinct meanings: viewport Unlock and WM_PAINT repaint. Existing entry/exit imports can distinguish them without rebuilding the module.** Both can copy the complete client, so the old164 full-client uploads cannot yet be labeled gameplay frames.

## Binary-backed distinction

Frozen input is `scratch/ops-unreal-fps-20261002/fixture/test/binaries/candidates/unreal-special-edition/installed/system/windrv.dll`, SHA-256 `9646b1a168f658d62d616b87349c5de7f1abbe991ad7dcdee3cad74b9fbd2262`, PE preferred image base `0x10a00000`. GDI32 BitBlt is IAT RVA `0xa238`. PE import/export mapping and GNU objdump2.47.20260726 disassembly were read only; no binary was executed. Evidence: `pe-map.json`, `callsite-context.json`, `unlock.asm`, `wndproc-dispatch.asm`, `other-blit.asm`.

| Path | Export / branch | BitBlt call RVA | Return RVA |
|---|---|---|---|
| Completed viewport submission candidate | `UWindowsViewport::Unlock(int)` export RVA `0x2fc0` | `0x3175` | `0x317b` |
| Existing viewport repaint copy | `UWindowsViewport::WndProc` export RVA `0x6100`, WM_PAINT15 dispatch to RVA `0x6311` | `0x6404` | `0x640a` |

These are two direct `FF 15` references to the pinned BitBlt IAT within executable sections, not a claim that arbitrary indirect code can never call the API. Runtime unknown callers remain explicit failures of attribution.

Unlock calls imported Engine `UViewport::Unlock(int)` at preferred VA `0x10a03019`, then gates presentation on its argument/valid visible viewport state. Its windowed path obtains GetDC, SelectObject selects the viewport bitmap into its source DC, and the call at `0x10a03175` pushes SRCCOPY `0x00cc0020`, source `(0,0)`, source DC, viewport height/width, destination `(0,0)` and destination DC. It tests EAX success afterward, then ReleaseDC. This is concrete support for a completed software viewport submission boundary; successful runtime membership still needs evidence.

WndProc uses a byte-index and address jump table at RVAs `0x7db0`/`0x7d90`: message15 selects index6 and target `0x10a06311`. That path checks visibility and calls BeginPaint at `0x10a06388`, obtains GetDC, selects the existing bitmap and performs its own whole-viewport SRCCOPY at `0x10a06404`. It is a repaint copy of already available viewport storage. The two sites must not be merged merely because dimensions/ROP are identical. The current upload-only artifacts do not identify which site produced each event; no retrospective count is inferred.

All VA values above are preferred-base disassembly addresses. A future observer must derive live WinDrv base from verified loader/module metadata and compute `returnAddress - liveBase`; never assume the preferred load address. Pin the exact DLL bytes and instruction bytes before accepting either return RVA.

## Minimal existing-hook proposal

The frozen worker's ESP audit already demonstrates local wrappers around `built.imports.host.log` and `log_api_exit` (`lib/guest-worker.js:426–435`). Frozen `src/09b-dispatch.wat:1452` calls log before argument loads, and `:1530` calls log_api_exit after handler completion. The API log flag defaults on (`:87`) and is inherited by worker settings; verify that entry/exit receipts actually arrive rather than forcing an unverified assumption. `lib/guest-rpc.js:467–476` otherwise consumes these log hooks locally when forwarding is off. Wrapping those local imports avoids full console/API RPC tracing. No new WAT seam is required.

At a BitBlt entry, bounded-read its actual API name, current exported ESP and ten stack dwords: return address plus the nine documented BitBlt arguments. Frozen `get_esp`, `get_eax` and guest reads exist; use the actual per-worker instance as the existing ESP audit does. These are observed runtime stack values, not hardcoded guest addresses. Capture caller RVA, destination/source HDC, destination/source origins, extent and ROP with a monotonically increasing invocation ID. During that invocation attach each existing `gdi_surface_upload` sequence/args to the invocation. On log_api_exit record EAX and ESP; BitBlt's frozen handler pops40 bytes (`src/09a4-handlers-gdi.wat:406`), providing a concrete completion/association check. Keep unknown/orphan/nested/unfinished calls as ambiguity, not silently omitted events.

To connect HDCs without guessing private structure offsets, retain bounded entry/exit records for GetDC/ReleaseDC, CreateCompatibleDC/DeleteDC, CreateDIBSection, SelectObject/DeleteObject as needed. Map returned destination DC to the actual HWND; map source DC selection to the created DIB handle and its existing GDI surface create/attach evidence. In this run the reviewed destination is HWND65539/surface6356994, with separate514×386 offscreen surface4259858; those IDs are observed examples, not portable future constants. Record new live association each run. A change or unproven source/destination association rejects admission.

First proposed observation is **one bounded attribution diagnostic**, at most10 source-clock seconds or1000 retained relevant API calls, whichever finishes first, on the already reviewed software single-player route. It is not a warmed measurement. Collect existing upload events and exact API entry/exit/success joins, retain both Unlock and repaint classes, and require no dropped events, clock errors, unknown selected uploads or worker/lifecycle ambiguity. A pure observational error must be caught and flagged while preserving original import calls/return values; instrumentation must not trap the guest or replace API behavior. Full-origin lifecycle and completed-stop/cleanup distinction from the counter review remain necessary. This is a proposal only: no driver integration or runtime is granted here.

The result should show whether selected successful Unlock calls map one-for-one to selected full-client uploads, how many WM_PAINT copies occur, and whether any unexpected GDI operation produces the same rectangle. If accepted, a later measured counter may be named **successful guest viewport Unlock submissions**. This is a game presentation boundary rather than arbitrary upload volume; it still does not assert unique image content, physical display completion or hardware rendering. Keep actual SwiftShader/browser composition distinct from the original SoftDrv guest rasterizer.

## Pure prototype and limits

`correlate.js` is an offline admission prototype, not an installed observer. It requires the pinned WinDrv identity, explicit reviewed runtime HDC/surface association, bounded unique invocation records, complete nine-argument BitBlt tuple, ESP+40 completion, nonzero EAX, exact514×386 SRCCOPY geometry, one matching upload and either the Unlock or WM_PAINT return RVA. It reports these classes separately; unknown/failed/unmatched calls reject attribution. `performance:null` remains fixed.

`test-correlate.js` PASS: synthetic Unlock versus WM_PAINT distinction, failed result, unknown caller, wrong ROP/source/extent, missing/duplicate/unmatched upload, wrong stack completion, non-BitBlt API, duplicate invocation and wrong/unreviewed module/association. Root review additionally caught undefined invocation IDs comparing equal and missing ESP coercing to0. The corrected prototype requires a nonzero uint32 invocation ID and finite uint32 entry/exit ESP (and result), with missing/null/empty/nonfinite/negative/fractional/overflow identity and ESP negatives passing. All register/HDC values in those tests are synthetic, not actual guest observations. No timing number or gameplay acceptance is derived from them.

Instrumentation still adds per-API dispatch checking, bounded reads/allocations, timestamps and serialization. The existing upload observer has its own overhead. A future diagnostic must record this honestly; neither console-heavy attribution timing nor the earlier5s upload probe can become an uninstrumented gameplay baseline. This preparation does not alter the pure prototype into a general render-loop redesign.

Next action: root review the binary evidence and exact local-hook proposal, then grant narrow isolated integration if desired. Preserve old metrics unpublished. Current task is at a safe checkpoint for the separately granted conditional Collapse run once explicit Jazz terminal/download/hash/cleanup release arrives; no remote ownership is inferred here.
