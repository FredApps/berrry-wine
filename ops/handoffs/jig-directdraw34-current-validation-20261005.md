# JigSawedME DirectDraw7 current-source validation

Private source 54fac8f7072ba56e1c7b8e7b1d0a433337f22d18 passed all production build/shake gates and 53 actual-WAT contracts (11 DirectDraw34 plus 42 surface contracts), session32606 exit0, 22.751 seconds. Production module: 1892b60a72b4a69faddd71bbc50f68344170bb485f8bd42bc42db2e9c70d0b40, 1,671,552 bytes. Shared canonical module remains unchanged.

The 34-slot table preserves old API identities, supplies real native TestCooperativeLevel status separately from COM HRESULT, and gives unsupported tail operations their exact ABI and explicit failure. Native-oracle and fake-owner, sparse-output, lifetime and stack contracts are in test/test-vbdd-directdraw34.js. Prior missing-slot and fake-owner failures remain preserved. The exact neutral-handler inventory delta removes two duplicate wrappers and adds one shared handler; no gate was waived.

Ordinary attempt2 (session62291 exit0) used the original 49,206-byte JIGTEST.BMP, SHA256 885aeb72abb4d1098e98e71eb7b203dc9af59cbd27c9030b8251f71008efd022. Normal startup succeeded; ordinary Upload/File Open displayed “Unable to Open the specified Image File”. The app remained alive in its error modal, unlike the prior EIP0 terminal result. This is not proof of puzzle gameplay or of the exact next failing API. No observer was installed, and the ordinary log names only the image-open message, not a failing operation. No FPS is claimed.

All 257 production source pins and 20 fixture hashes were checked; actual served-source validation passed. Browser/server closed at 2026-10-05T15:44:19.005Z with no cleanup errors; process check clear. Attempt1 is preserved separately as a harness setup failure: missing ignored binaries→test/binaries alias caused the executable URL to404. The alias was corrected and all20 served alias paths validated. The correction receipt was written after launch began, so it is not claimed as a prelaunch HTTP check.

Evidence:
- scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/current-production-gates-attempt3/receipt.json
- scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/ordinary-browser/attempt2/validation.json
- scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/ordinary-browser/attempt2/image-open.png (SHA256 c48bd5bb8dac1401e2237cf0ab4aa810884651f4bfba8d41c01b33e513cadb31)
- scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/ordinary-browser/alias-correction.json

Next: inspect the later native/VB image path and prepare a bounded owning completed-call/error capture on this corrected module if required. Do not infer a specific unsupported method from this ordinary screenshot, and do not repeat an image-only browser run.
