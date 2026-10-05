# VB Surface7 startup regression

Ordinary browser session13559 on production module608c0311 showed “Could not initialize Direct Draw” before File Open. The 12 offscreen contracts and full gates did not cover startup's primary surface. Root reverted the production patch; no gameplay claim.

Static guest code42b851 writes descriptor43b1dc flags1;42b85b writes its VB caps(+200)=0x200. CreateSurface slot7 at42b876 checks HRESULT42b879. The failed candidate explicitly rejects that primary-only shape. Next, startup uses surface SetClipper slot46 at42b97d, also previously supported but unimplemented by that candidate's new table. These are exact static calls, not recovered owning trace records. Corrected source preserves native primary allocation/current display size and real SetClipper HRESULT/refcounts; source-only13-group tests are prepared, not yet run.

ENOSPC occurred during quit and cleanup evidence writes. Console history and original served validation were lost; empty originals remain. Raw served responses were independently revalidated successfully afterward. Cleanup receipt records browser/server closed11:44:29.866Z; stdin-only driver was interrupted after closure, exit1, processes clear. Screenshot and source/provenance hashes are in the accompanying JSON; no invented missing logs.
