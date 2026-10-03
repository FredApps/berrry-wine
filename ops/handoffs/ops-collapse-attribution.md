# Collapse originating API attribution prototype

Owner serious_review / codex:01a0f9db-89c0-73b3-b528-fe8bf239e061. Local preparation only, in `scratch/ops-collapse-attribution-20261002`. Ten pure mock cases pass; identities are pinned in `identities.json`. No fixture copy, source mutation, module build, network, browser, runtime or measurement. Conditional GTA2 grant remains waiting for explicit NFS3 release.

## Concrete binary evidence and unresolved render role

Pinned Collapse3.exe SHA256 is7f581e685db736239993efa843b145d085372c90c2d094f9fa4f1a3772947edb. Module is1930e089068d43e0e42d4af2523f027ca97a389937507ef468c1950df117a146, the accepted audio plus private SET-timer fixture. `inspect-pe.py` reads the original EXE bytes only. `pe-evidence.json` records sections and imports. GDI32 BitBlt IAT RVA is0x7a0b4; one executable-section FF15 pattern calls it atRVA0xa3e3, with returnRVA0xa3e9. This is a direct byte-pattern census, not exhaustive proof against register-indirect calls or dynamically resolved imports.

`bitblt-aligned.asm` starts at the known instruction0x40a3a2 and shows SRCCOPY0x00cc0020, zero source origin, source DC and dynamic destination/extent operands before the import. Unlike Unreal's two separately classified Unlock/WM_PAINT sites, this evidence provides only one shared copying site. Its immediate return RVA cannot distinguish render completion from repaint or intermediate calls. The59 prior uploads remain unattributed; they must not be retroactively assigned here.

`bitblt-context.asm` preserves an initial disassembly beginning midinstruction0x40a390; do not use its first instruction. `transfer-wrapper.asm` preserves a heuristic function-start candidate0x40a336 returned by find_fn, but the code already depends on established ESI/EBX state. That candidate is NOT accepted as a function entry or a stack-unwind basis. A render-role decision needs a proven enclosing caller/control path after actual runtime API association. No game-field address or guessed return-stack offset is proposed.

## Existing seams and prototype

Frozen `lib/guest-worker.js:426–435` already wraps host.log/log_api_exit for ESP audit immediately before instantiate. Dispatch `src/09b-dispatch.wat:1452,1530` supplies entry before argument loads and exit after handler completion; verify those callbacks actually occur in each selected worker. `src/13-exports.wat:385–386,3197–3202` exports current ESP/EAX and guest reads. Existing log forwarding may be disabled while local imports still execute. No new WAT import or recompilation is required for API/stack capture.

`observer.js` prototypes wrappers for actual originating log, log_api_exit and gdi_surface_upload imports. It accepts pinned known API names, this worker's memory/exports, source clock and verified live module ranges. It reads the observed stack return and supported argument counts, including nine BitBlt arguments, HDC-management API fields, destination/source HDC, origins, dimensions and ROP. It joins uploads to current calls, records EAX/ESP completion and module-relative return, and preserves original this/arguments/results/exceptions. Non-BitBlt API names, unknown callers, orphan/nested/unfinished calls and extra uploads remain explicit; unsupported argument schemas are null rather than guessed. Module names/ranges/hash are supplied observations, not inferred from preferred load base.

Bounds are10 source-clock seconds,1000 retained API records,2000 uploads,64 error records and64 stack entries. Errors/overflow reject diagnostics; hook observation failure does not replace the original host import. The prototype is not yet serialized into a worker or combined with lifecycle tracking. It samples all known API entries during its short window, which has higher overhead than a final narrow counter. It produces transferAttributionCandidate only for successful matching BitBlt at the pinned caller with one joined upload; gameFrameQualified is alwaysfalse and performance null. Candidate means API attribution only: it does not prove HDC association, child coverage, completed rendering or page success.

The original seven tests cover observed stack/caller/ROP and unchanged forwarding; unknown caller/non-BitBlt/failure; orphan/repeated/unfinished uploads; clock deadline/regression/capacity; read failure preserving original result; immutable snapshots/single arm; and unchanged original exception. These use synthetic registers and memory. They neither execute guest code nor assert live API logging is complete.

## Source-backed child and source association design

The prior run's800×600 upload on top-level808×628 surface differs from its cached802×601 top-level client and matches the visible800×600 child. Frozen `src/10f-gdi-dc.wat:1390–1395` resolves window backing through wnd_top_level. Its descriptor path at:1934–1960 reads the DC window binding, obtains that top-level owner surface, and derives drawing origin from child client-screen coordinates minus owner's window-screen coordinates (window DC uses window coordinates instead). Descriptor offsets68/72/76 hold canonical surface ID and origin. `src/10g-gdi-raster.wat:204–221` publishes that surface and resulting rectangle. This explains a possible child→parent canonical route without proving which HDC the59 calls used.

Next isolated integration must capture source-backed actual association, not dimensions alone. Options: observe GetDC/GetWindowDC/BeginPaint completion and ReleaseDC/EndPaint across all six contexts from initialization, plus CreateCompatibleDC/CreateDIBSection/SelectObject/DeleteObject/DeleteDC for source backing; and/or bounded read-only snapshots of the actual GdiDcState record at entry. The frozen table scan at `10f-gdi-dc.wat:44+` is keyed by HDC, with compiler-placed region and declared96-byte layout. Derive offsets/region from that exact source and RegionMap; never call mutating gdi_surface_descriptor/window_surface_ensure exports for observation. Shared HDCs may be created in another worker: missing local creation is unknown, not nonexistent. Any table reader must retain live binding, bitmap, mapping transform and before/after stability, with explicit double-read/shared-memory limits.

Resolve the observed binding through actual window ancestry/client origin to the observed canonical surface and verify the BitBlt destination rectangle maps to the upload. Preserve source DC selected bitmap/DIB identity and dimensions from witnessed lifecycle or typed source-derived state. A successful untyped SelectObject must not be assumed to change the bitmap; reuse the accepted Unreal conservative invalidation policy until a typed bitmap is proved. Do not reuse Unreal RVAs or surface IDs.

## Bounded next step

Root may grant a separate small integration preparation: serialize the prototype at the existing seam, add source-derived DC association readers/lifecycle joins, verified live EXE range and relocated FF15 instruction witness, and immutable phase-tagged six-context coverage with exact ID sets. Preserve the accepted normal-click route and originating GDI buffer. No new counter or large fixture copy is needed before those readers and meaningful tests are reviewed.

Then one separately granted short diagnostic can determine actual API/caller/source/destination/success membership and identify any repaint/intermediate operations. A subsequent read-only caller-path investigation can establish whether the observed shared site is invoked at completed board rendering. If it cannot distinguish that role, retain successful selected BitBlt submissions as the precise observable quantity and leave game-frame admission closed. Page flush/compositor completion is a different measurement. This prototype alone does not enable timing, certify full frames, merge clocks or waive unknown calls.

## Review corrections and final release

Explicit stop now applies the same source-time limit as import callbacks. An otherwise idle stop requested after15seconds records the effective ten-second endpoint, with no additional import needed; admission independently rejects durations above10000ms. No timer or guest callback is added.

Admission now checks both directions of the call/upload relation. A successful selected pinned-caller SRCCOPY BitBlt with no upload is rejected even when a separate call has a valid upload. Calls with multiple or mismatched upload references also fail. This remains selected transfer attribution, never game-frame certification.

Invocation/upload IDs must be unique positive uint32 values. Registers, argument words and caller base/RVA must be finite integer uint32 values; caller base+RVA must reproduce the observed return. Entry, exit and upload times must be finite and within the effective window with causal ordering. Validation precedes unsigned stack arithmetic, so missing/null/string/nonfinite/fractional/negative/overflow fields cannot pass through coercion. Malformed container shapes may throw; integration must catch and fail closed.

Three added pure cases exercise the actual observer idle-stop path, one joined transfer plus a successful zero-upload transfer, and malformed identities/registers/times/arguments. All ten tests passed. Updated hashes below supersede the initial prototype release. No integration, large copy or runtime occurred.

- observer.js: `a89d0c460df14945166648807efb27c0af5f25ae5eb4e7d122b443fb3e12b77b`
- test-observer.js: `292524c34be6a845c6c456e5159b931b7ef93154e13a32fb43c7c6bd27f8ce9b`
- test.log: `9e33f63e34c20facd56398e60b9d8b0aed0f19cfefb0d0d289e8a7e012c081c9`
