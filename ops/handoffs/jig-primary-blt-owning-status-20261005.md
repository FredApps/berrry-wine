# Jig primary Blt native status after successful rectangle getter

Private owning-Worker diagnostic4841 on exactproduction42408 opened retention only after completed GetWindowRect caller4312e2 returned COMS_OK/ESP16. Returned RECT is[4,42,1020,736]. Next completed Surface7Blt caller431366 returns COMS_OK/ESP28 but drawing statusE_NOTIMPL80004001. Destination authenticated slot5 is640x480 RGB565/pitch1280/refcount1; source slot16 is1016x694 RGB565/pitch2032/refcount2. DestinationRECT is[4,42,1020,736], sourceRECT pointer references fourzeroDWORDs, flags01000000. These are actual owner-call values, not inferred from screenshot.

125 records retained after positive phase gate; no captureerrors/ambiguity; dropped-callcounts explicit. Later retained TestCooperativeLevel has COMS_OK and nativeStatus0. Image remains gray with loadedfilename, no gameplay. All three original imports restored; browser/server closed2026-10-05T16:57:31.517Z, sessionexit0, processcheckclear, servedidentityPASS. PrivateWorker803dc098 is instrumentation and not a production/performance run.

Evidence scratch/new-games-pipeline-20261004/jigssawme/getwindowrect-repair-20261005/presentation-diagnostic/attempt1/validation.json SHA256 984c467830d538e553b108adc2268839099f50121ea536b878791adb3cf20478, owner-snapshot.json, observer-cleanup.json and image-open.png.

Source localization: current vbdd_blt_rect rejects destination right1020>surface640 and bottom736>surface480 with80004001 before native Blt. Other retained preview draws use flags0x20 and also have explicit unsupported status; do not generalize one failure to every blank pixel. Next compare originaldx7vb zeroRECT conversion and native clipping/primary semantics before any repair. No resizing, forced copy or fabricated success has been applied.
