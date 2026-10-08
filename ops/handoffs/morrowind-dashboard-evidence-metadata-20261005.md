# Morrowind dashboard evidence repair

The accepted prison-movement run was initially absent from the live dashboard. Its result lacked required `startedAt`, used a descriptive string instead of `verification: "reviewed"`, and misspelled `gameplaySceneReview` as `gamePlaySceneReview`. Its captures and movement evidence were valid; the metadata did not satisfy the reader schema.

Corrected `scratch/runs/20261005-morrowind-prison-movement/result.json` records the first preserved startup receipt, 2026-10-05T18:14:02.203Z, explicitly as the timestamp basis rather than an exact process-spawn time. Finish time comes from cleanup at 18:23:55.881Z. The build records source94d18605 and module2e2fd8d1, with fix main520d1cde and findings main80c6be42. Review fields now use the reader's exact schema.

Original result and hash manifest remain under `metadata-original/`; `metadata-correction.json` records their hashes and the reason. All capture/source bytes remain unchanged. The updated manifest contains331 artifacts.

The running dashboard API refreshed at 18:41:59.214Z and returned this run with verification `reviewed`,19 visuals and4 gameplay screenshots, with no Morrowind warnings. No service restart or public deployment occurred. FPS, sound quality and later game progression remain unqualified.
