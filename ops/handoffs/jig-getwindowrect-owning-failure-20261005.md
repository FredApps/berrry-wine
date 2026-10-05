# JigSawedME: completed GetWindowRect failure

The private bounded owning-Worker diagnostic on production module1892b60a captured IVBDirectX7_GetWindowRect (API4076) returning E_NOTIMPL (0x80004001), completed with expected ESP delta16 and return address0x4312e2. Actual arguments: this0x8009018, HWND0x10007, output RECT0x937db4. This identifies an actual unsupported operation after the previously truncated DirectDraw7 table was repaired. The app remains alive with its image-open error modal; no puzzle gameplay is qualified.

Native drawing error and COM failure remain separate: earlier BltFast had COM S_OK with DDERR_INVALIDRECT, as previously implemented and tested. The first failed COM call was independently reserved after125 ordinary records. Total retained126; original imports restored, errors0, no ambiguous pairing. TestCooperativeLevel was encountered but its successful completed record was dropped by the cap; its exact output is unknown in this capture. No MessageBox API event was retained; the visible modal and console text are separate evidence. Dropped records prohibit broader absence claims.

The observer is a PRIVATE Worker override4a802413, not a production performance measurement. Production sources match tested54fac8 and integrated main2f9bbd43. No guest state writes or fake API returns. Session9211 exit0; browser/server closed2026-10-05T16:17:04.562Z, cleanup errors[], process check clear.

Evidence: scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/next-error/attempt1/validation.json (SHA256 0be8e850f47bfea916146102b81386eb4c8e71183e110d1502fc2e7f450625b9); owner-snapshot.json; observer-cleanup.json; image-open.png.

Next: verify native IVBDirectX7.GetWindowRect contract, real HWND/RECT conversion and caller error branch. Implement only source-backed behavior with sparse guest output and actual-COM before/candidate tests; no repeated browser just to rediscover this unsupported API.
