# Tile World

Registry/candidate `tworld`; active lane NEW-GAME-TWORLD-20261004. Live public desktop exclusion and all16 registered files verified in scratch/new-game-tworld-20261004/preparation-receipt.json. No gameplay qualified yet.

Historical run scratch/runs/20261003-tworld-gameplay-restored4 uses d2c module: readable SDL set picker, then black client after Enter/click/Enter. Only3.5seconds observed after final selection; actual selected set, input-consumer focus and owner PC were not captured. No specific trap or missing DLL proven.

INSTALL.txt explicitly says keyboard-only UI. Mouse click can establish focus but cannot select a row. Planned ordinary route: inspect picker, establish focus, visibly navigate with arrows to intro-ms.dac, Enter, then inspect board before ordinary directional input. Intro descriptor selects MS rules and intro.dat; registered font.bmp/tiles.bmp/SDL.dll all present. RC also names27 additional unmounted resources, mostly sounds plus Lynx atiles.bmp; do not blame them absent actual failing requests.

If black persists on current pinned build after bounded5–10seconds, capture actual owning EIP/ESP/thread inventory, input delivery/focus, file errors and live surface/transfer identity. Distinguish event wait, spin/trap and actual black raster; no guessed rendering patch or guest-state writes. Prepared300sec helper requires explicit slot grant; no browser/build performed during preparation.

## Current ordinary route: audio shutdown wait

2026-10-04 attempt1 retains the filename/ruleset picker on its black background after positively selecting intro-ms.dac with four ordinary ArrowDown inputs. Main owner EIP0x66a920 waits INFINITE on thread0xe1000; audio worker EIP0x6689e9 waits INFINITE on0xe0002. Shared DLL_TABLE from owning exports locates SDL.dll at0x63c000,size0x4b000. SDL_WaitThread export runtime0x6449d1 is called by audio shutdown at0x63dc7a; backend wait0x6689e9 reads device+0xbc then+4. WOM_DONE callback0x668a31 handles0x3bd by ReleaseSemaphore on that same field. This is a semaphore-path wait, not proof of an event object.

Immutable source/raw evidence scratch/runs/20261004-tworld-intro-audio-wait:158 hashed artifacts, actual owning stacks/wait globals/DLL table, disassembly, ordinary input receipts and screenshots. Browser94002 exit0; cleanup06:11:24.851Z bothclosed, ps clear. No gameplay/FPS.

Next investigate waveOut completion/callback delivery versus SDL shutdown ordering; exact cause remains unproven because no header/notification history was captured. Raw stack words are not a complete unwind: do not attribute the Tile caller from coincidental words. No graphics patch or forced wakeup justified. A narrowly bounded passive audio callback/header census may be needed after source review.

Passive attempt2 confirms stalled legitimate callback delivery: same two WAVEHDRs (flags3 DONE|PREPARED, no INQUEUE) remain in CALLBACK_FUNCTION queue before and after Enter. AudioContext runs and advances10.159→13.444seconds during the stalled picker captures; SDL device enabled1→0, main joins audio thread e1000, worker waits semaphoree0002. ExactSDLfile/DLLtable/callbackprefix checks pass. No forced callback/signal; no gameplay. Why selection triggers audio shutdown and later game behavior remain separate unknowns. Immutable scratch/runs/20261004-tworld-callback-census; browser39764exit0, cleanup17:55:18.203Z bothclosed. Shared owning-callback repair proposal in callback-file-review.md.

2026-10-04 root visual correction: attempt2/after-5.png retains filename/ruleset picker text on black, not a blank client. Published result summary corrected with prior result SHA and image-bound review correction; original result preserved in scratch/new-game-tworld-20261004/repair/published-result-before-scene-correction.json. Raw analysis wording is historical; no gameplay was reached.

2026-10-04 private repair evidence: actual integrated host completion queue → owning Worker callback → real semaphore release → audio Worker natural exit → main join resolution passed; unchanged host-queue control remained parked. Reset/header reuse/non-function callbacks and lost-ack/close were exercised. Production and canonical module are unchanged; root review, one suspended-owner guard regression, compatibility/build and fresh ordinary gameplay remain pending. Exact handoff: ops/handoffs/tworld-owning-wave-callback-20261004.md; frozen receipt: scratch/new-game-tworld-20261004/repair/integrated-validation/receipt.json.
