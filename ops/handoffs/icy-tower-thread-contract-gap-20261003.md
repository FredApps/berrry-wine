# Icy Tower: thread wrapper resolved, callbacks not captured

Icy5 remains a rejected prearm diagnostic, not a gameplay failure or FPS result. See `scratch/gameplay-icy-tower-counter-20261003/attempt5/failure.json` and its preserved log.

The log identifies MSVCRT.dll at runtime base005f8000, original base78000000, DllMain005fb428. Thread start0060393e therefore maps to RVA0000b93e/original VA7800b93e. Local `test/binaries/dlls/msvcrt.dll` SHA256 is887eb5ce93edb7192ca3e9220f07f9ca0f94db02af5862ebcbdfcb852db99fd1. Its exact wrapper disassembly is saved in attempt5/crt-thread-wrapper-disassembly.txt. This local DLL identity matches the logged mapping; actual served DLL bytes were **not** hashed by browser5, whose response filter covered JS/WASM/EXE. That provenance gap must be closed in any future collector.

The wrapper loads ESI from its thread parameter at7800b964, installs TLS, then at7800b98f pushes `[ESI+4c]` and calls `[ESI+48]` at7800b992. Thus60393e itself is a CRT wrapper, not an identified sound/render callback.

| Logged thread | CRT parameter | Missing callback word | Missing callback argument |
|---|---|---|---|
|1|0063fb0c|0063fb54|0063fb58|
|2|00657eac|00657ef4|00657ef8|
|3|00656f34|00656f7c|00656f80|

Those six heap words are outside the original mapped image and outside every bounded linked object captured in attempts1/4/5. Actual thread-state/context vectors at bind were also not saved. Existing artifacts cannot name the callbacks or prove they are exclusively audio; nearby waveOut logging does not establish that fact. No additional runtime was launched to fill these gaps.

A whole-program write-set proof would be stronger than the intended metric. A completed logical render submission does not assert that simulation or pixel contents represent one atomic game-state snapshot. A justified revised contract can allow cooperative background work while authenticating one main render/checkpoint owner, enumerating every context and generation, recording all selected-surface/same-HWND transfers from every origin, and rejecting any competing or unattributed submission. Exact full-row copy coverage, code/caller/HRESULT proof and stable target must remain mandatory around each iteration. Context creation/replacement during a sample must reject rather than disappear from capture. No background thread may be paused or repaired to fit the measurement.

This is a proposed semantic boundary, not implemented or accepted qualification. Current single-context/no-active-thread gates stay in place until a revised observer and negative tests receive independent review. Icy gameplay FPS remains unknown. The debugger repair remains independently useful and validated; it does not qualify this game's render counter by itself.

## Revised multi-context diagnostic implementation

The logical claim is one completed render submission, not an atomic simulation snapshot. The new private adapters authenticate the main render exports and every import context against the cooperative thread manager's actual record/instance identities. They freeze context, exports, record, handle, TID, start address, parameter and active lifecycle; sleep/wait scheduling fields may vary. Pending threads, missing/duplicate/unhooked contexts, new contexts, replacement records and exits reject. A maximum of 32 origins bounds all inventory walks. Inventory is checked before/after scheduler slices, at target callbacks, at checkpoints and stop.

All hooked contexts observe the selected canonical surface or any surface on its HWND. A foreign origin's submission remains `unattributed`, with its actual origin token; it cannot satisfy the owner-only transfer chain. The existing row/code/copy/order/HRESULT/target checks remain. Six raw words at authenticated thread parameters +0x48/+0x4c are read with bytewise sparse-mapping validation when available; absent mappings are recorded explicitly, callback role stays null. These words are not claimed to authenticate CRT semantics without the independently loaded DLL evidence.

43 focused tests pass, including added pending/exit/replacement/new-origin collector cases, foreign submissions and unchanged sleeping metadata. Exact review identities: `scratch/gameplay-icy-tower-counter-20261003/multi-context-review.json`; log `multi-context-tests.log`. Prepared `browser6.js` preserves attempts 1–5, captures origin inventory before arm, and includes DLL response hashes. No new runtime occurred. Next launch still requires root review/grant; 150-second route guard and two-iteration/five-second checkpoint bound remain. FPS is always null; debugger pauses do not measure ordinary gameplay performance.

Root review correction: removed a remaining `hasActiveThreads()` check in the scheduler wrapper. Active background threads now reach the real wrapped slice under frozen-inventory guards. Finish captures inventory errors independently, always attempts breakpoint and marker cleanup, retains each failure in the receipt, and reaches `onStop` even if recorder/breakpoint cleanup fails. Added actual active-thread slice and finish-inventory-throw regressions plus breakpoint-cleanup-failure regression. Updated total: 45 tests pass; review hash receipt refreshed. No runtime.

Icy6 preparation repinned to actual canonical `5ff4844e5e4a2cc54d752d2235de9793999a7f0e651015693f01c8dcf4309ce1` (1,657,773 bytes, root build 2475); separate `checkpoint-build-receipt-icy6.json` preserves older build receipt. No old attempt bytes edited. Static lifecycle review confirmed delete is sampled before map removal. Added attach/create observation: foreign or competing attachments/creation reject, including a newly attached surface not previously on the target HWND. Owner idempotent calls are allowed only while presentation object, HWND, DIB/palette pointers and geometry remain unchanged; transient replacement records an unattributed lifecycle event immediately. Added collector regression for foreign attach→delete and owner replacement; 46 tests pass. Browser slot remains unlaunched pending grant.
