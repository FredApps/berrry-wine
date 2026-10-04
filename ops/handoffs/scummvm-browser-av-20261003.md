# ScummVM fullscreen and audio check

Current-source loopback only. Corrected session26616 exited0; browser closed23:02:44.772Z, process check clear. No production changes or further runtime. Attempt1 selector error is preserved as a harness failure.

Ordinary click320,220 focused the visible game area; Alt+Enter did not visibly leave windowed mode. document.fullscreenElement stayed null, renderer._exclusiveFullscreen false. Browser fullscreen consent existed but was hidden, so it was not forced. Ctrl+F5 showed no menu in this bounded check. The later CDP attachment resized viewport800x600 by default; that is a harness side effect, not guest/browser fullscreen success. No generic keyboard root-cause claim.

Worker backend, running22050Hz audio context, stream voice22050Hz stereo16bit. bytesWritten stayed44096 across20.134s. CALLBACK_FUNCTION type3,target11006272; functionDoneQueue remained2, pendingWaveDoneCount0. Auxiliary thread1 remained active/not in flight with workerSlices11 and lastEip11005344/lastYield1. Initial audio submission stopped while function completions stayed queued; no intentional-silence claim. No OS recording after root confirmed the stalled queue evidence was sufficient.

Publication, exact snapshots, inputs/screenshots, source response checks, cleanup and artifact hashes: `scratch/scummvm-av-20261003/publication.json`, `scratch/scummvm-av-20261003/validation.json`, `scratch/scummvm-av-20261003/attempt2/`.101 served production responses matched prelaunch pins, zero successful mismatches. Source/module identities are recorded separately from public deployment. No FPS or gameplay acceptance claim.
