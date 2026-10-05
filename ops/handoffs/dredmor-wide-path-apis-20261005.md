# Dredmor settings-path API repair

Owner: corpus_categories. Isolated source rebased to c12a57a65709d15a94cc65cd95f1d16c83550197, preserving all58 newly integrated DirectX7 API IDs. No shared production edits. Current status: private real-dispatch regression PASS40, exact old-dispatch negative control reaches the missing-API trap, full private production gates PASS. Ordinary private runtime now reaches the launcher and main menu with successful lazy range reads; gameplay remains unqualified.

The immutable run `scratch/runs/20261005-dredmor-lazy-startup-pathappendw` reaches an unimplemented PathAppendW at1128ms. EXE calls SHGetFolderPathW(CSIDL_PERSONAL), PathAppendW with `Gaslamp Games\\Dungeons of Dredmor`, PathFileExistsW, then SHCreateDirectoryExW only if absent. This is settings-directory setup; zero lazy reads preceded the trap. Clearing it is a prerequisite to testing actual in-game loading behavior, not proof of gameplay.

## Contract and scope

Primary contracts: [PathAppendW](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-pathappendw), [PathFileExistsW](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-pathfileexistsw), [SHCreateDirectoryExW](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shcreatedirectoryexw). Legacy lexical behavior was cross-checked against Wine's kernelbase/path.c implementation; this is an independent bounded WAT implementation, not a port of its source.

- PathAppendW: MAX_PATH UTF-16 inputs, separator insertion, drive/UNC suffix replacement, single leading separator handling, lexical dot/parent components, preserved repeated separators/non-ASCII units. Temporary per-call heap buffers support aliased input. Overflow returns FALSE and clears destination, consistent with the legacy combined-path failure behavior.
- PathFileExistsW: real existing VFS attributes, including directories; absent objects return FALSE/ERROR_FILE_NOT_FOUND. UNC server/share roots are excluded. Sparse strings are validated/code-unit copied to a per-call heap buffer before the existing host filesystem import.
- SHCreateDirectoryExW: fully qualified local drive paths, documented248-character bound including NUL, real ancestor/file checks and recursive creation. Existing leaf returns183, unavailable drive3, read-only/create failure5, invalid characters123, relative path161, excessive length206. A non-null security descriptor request returns ERROR_NOT_SUPPORTED50; no security success is fabricated. No remote share provider exists, so UNC creation returns ERROR_BAD_NETPATH53. The ANSI entry now delegates through the existing byte-to-wide conversion to the same implementation; valid recursive creation is preserved, while incorrect prior successes for relative paths and file ancestors are intentionally corrected. ANSI parity cases are prepared for the next focused run. The VFS has no access-control visibility prompt model; no new UI/permission simulation is introduced.

No new host imports, RPC path, browser changes or shared scratch region. Path APIs append as IDs4085–4087; existing IDs remain unchanged. New handlers live in the existing shell fragment; API entries are append-only with generated dispatch/hash tables. Standard test discovery places the focused regression in the unit tier.

## Tests so far

`node test/test-shell-wide-paths.js`:40 actual generated-dispatch cases PASS on c12a57a6 (session58923 exit0), including six ANSI cases. Checks return values/stack cleanup, Dredmor's exact doubled separator suffix, drive/UNC replacement, dot/parent normalization, Unicode, overlap, MAX_PATH edge, real VFS files/directories, recursive creation, sparse discontiguous pages, relative/invalid/long paths, existing file ancestor, unavailable drive, trailing/forward separators, unsupported security and read-only failure. Static API generation, handler ESP, logical-and, A/W census and test-tier checks pass. The ANSI wrapper and bounded-read refinements passed. Full build first correctly caught a duplicate indexed WORD store; the final shell wrapper reuses the identical existing win16_rect_set helper, which has no mode/rectangle state. Final helper-reuse source also passed the focused40-case run (84653 exit0) after the full production build. First private compile detected malformed nesting and failed; corrected source then passed. All process handles released.

Negative control: exact bc6c8f37 before dispatcher reached crash_unimplemented followed by actual WASM unreachable on the first PathAppendW dispatch (55815 expected failure); no compiler/setup failure. Initial control setup hit execFileSync default maxBuffer before source mutation, corrected to8MiB. Candidate dispatch restoration/hash verified. Full private build61897 exit0, all gates PASS; production module SHA256162478613568105d1420d1c63c4aff5bff4bd0f4fe777ce7bb19773c91d5ce41,1,665,053 bytes, layoutd1e6d2a7ebbbc1e3, no test exports. Shared canonical module remainsf40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063.

Next: parent integration validation and a separately granted streamlined New Game continuation. Preserve both immutable runtime results and their actual source identities.

## Disk receipt

Removed only redownloadable beta7z and retail DAT/blob sources after verifying every extracted file SHA/length plus source SHA/length.12,842 extracted files remain unchanged;464,848,325 source-cache bytes removed. Original source inventories remain in each `.candidate-source.json`; exact deletion receipt is `scratch/dredmor-lazy-20261005/source-cache-retirement.json`. The old clean COMI timer and phase1 worktrees were retired; published commits and immutable run evidence remain.

## Ordinary runtime after repair

Private ee432681/module16247861 session97916 closed browser/server with errors[] at2026-10-05T11:06:52.125Z. Exit2 was the predeclared180second guard, not a guest failure. Actual registered release reached the configuration launcher, responded to resolution selection1024x768 and Start Game, and rendered its main menu. New Game click occurred176733ms; no subsequent setup/gameplay image before the guard.

Immutable run: `scratch/runs/20261005-dredmor-lazy-main-menu`,32 hashed artifacts,97 served identities checked.6,248 lazy mounts;1,437 successful206 range requests to1,306 distinct lazy files;16,918,607 lazy server-body bytes;21 distinct required companion URLs; zero game HEADs and zero game HTTP errors. Total game traffic27,589,854 server-body bytes. These are server writes, not independent client consumption. Native msvcrt fallback now returned200 through the corrected alias. Preserved browser abort records include split native fetch cancellation; no resource HTTP error for game paths. Optional build-info/favicon/app-icon404s remain recorded.

Successful on-demand reads are now demonstrated in the real game. Loading/Retry/Quit UI was not visibly observed, and no failed lazy read was induced; error/retry UX remains supported by focused tests, not newly runtime-qualified. No gameplay, FPS or audio claim. The configuration screenshot shows SFX mute checked during dropdown interaction. Root separately reviewed the main-menu screenshot.

The run uses c12-based API IDs4085–4087. Parent integration later regenerated atop the laptop_mbsstr addition; those IDs are different and must not be substituted into this immutable run. Next ordinary progression plan: `scratch/dredmor-lazy-20261005/route-attempt3.json`; batch known scroll inputs with normal800ms settles and review only actual transition gates, so configuration does not consume most of the180second allowance. Root queues Hype then Jig before this follow-up.

## Combined-main integration validation

Concurrent laptop commit939d8a3e added _mbsstr at4085 while publication was in flight. The integration tree rebased onto it and regenerated from its authoritative API table: all4086 existing rows compare exactly, with path APIs now4086–4088. Final integration89c1ed6e passed the complete private production build and40actual-handler cases. The initial sparse checkout lacked tracked ToyVM browser bundles; materializing those files allowed a clean full-gate rerun, without a waiver. Module SHA256 40cc834b014b46a9ea5c81f21ee000a41e3a70c6422e70c8aa42f22407bfaced,1665281bytes. Receipts: scratch/dredmor-lazy-20261005/integration-build-corrected.log and integration-focused.log. Canonical/public runtime untouched.

Ordinary prior candidateee432681/module16247861 reached the rendered configuration screen and main menu. Immutable20261005-dredmor-lazy-main-menu records6248 lazy mounts,1437 HTTP206 requests to1306 distinct lazy files,16,918,607 server-body bytes,21 required companion URLs,0game HEADs and0game HTTP errors. The180second guard closed browser/server cleanly; NewGame was clicked near the deadline but no subsequent gameplay state was recorded. No naturally visible wait overlay was captured, so runtime wait/retry UX remains unqualified. Root reviewed the main-menu screenshot and sent Telegram461.

## Merged-source natural wait UI, attempt3

On merged45e3f361, exact123 WAT/closure/compiler file comparison allowed reuse of root's full-gates module40cc834b014b46a9ea5c81f21ee000a41e3a70c6422e70c8aa42f22407bfaced (1,665,281 bytes), with path IDs4086–4088. No redundant compile or source change. Session77588 closed browser/server11:17:38.496Z errors[] at the180second guard; immutable run `scratch/runs/20261005-dredmor-natural-loading-ui` contains26 hashed artifacts plus their hash manifest and97 verified served pins.

This ordinary run visibly displayed the existing Loading window during natural lazy reads (`main-menu.png`, despite that provisional filename) and resumed automatically into the actual menu (`menu-resumed.png`). No artificial delay/error was injected. Same1,437 successful ranges/1,306 lazy files/16,918,607 lazy server-body bytes and zero game HEAD/HTTP errors. Thus successful on-demand loading **and visible wait/resumption** are now runtime evidenced. A failed read and ordinary Retry/Quit interaction are not yet tested.

Exact timing: first configuration click39.5s, Start75.6s, Loading screenshot85.6s, resumed menu132.8s, New Game167.3s. Sequential image review/tool round trips consumed much of the allowance; last lazy range occurred92.7s. New Game down/up were delivered in the same logged millisecond and the button was highlighted, but setup did not appear before closure. This does not prove an input defect or successful gameplay. A future ordinary route supports an explicitly logged100–150ms normal pointer hold; no engine fix is proposed on this evidence.

Separate prepared fault-UX helper: `scratch/dredmor-lazy-20261005/wait-ux`. It delays one exact known lazy range2500ms then returns503 once, leaving all later requests untouched; the operator must click the actual visible Retry button. Four capped captures and cleanup settlement are tested. This diagnostic remains separate from ordinary game qualification and awaits root review/grant.

## 2026-10-05 transient range recovery and ordinary New Game input

Published immutable evidence: `scratch/runs/20261005-dredmor-transient-range-recovery` (37 hashed entries,38 total files including hash manifest;97 verified served source/assets pins). Source45e3f361/module40cc834b, runtime75629 exited0 with browser/server closed11:29:05.677Z, cleanup errors empty.

A private HTTP-only fault delayed the exact manTemplateDB.xml range bytes0-6562 by2500ms and returned503 once. The unchanged provider automatically retried255ms later and loading resumed into the menu. This did **not** exercise user Retry: provider defaults to two retries (three attempts total), so the prepared next diagnostic must fail exactly those three requests before allowing original bytes. Samples at142ms and946ms after request respectively show no overlay and Loading; they are sequential observations, not an exact500ms threshold measurement.

After recovery, one ordinary150ms held click on visible New Game reached **Choose Your Difficulty** (`new-game-held.png`, root independently reviewed). This is setup/input evidence, not player-controlled gameplay, and comes from a fault-recovered diagnostic rather than a pristine route. It disproves a blanket claim that New Game is unusable; previous instantaneous clicks remain insufficiently diagnosed. Next ordinary route uses the verified hold and advances difficulty/skills. No FPS/audio claim.

## 2026-10-05 actual failed lazy read → user Retry → recovery

Core lazy-loading runtime qualification now passes. Immutable result `scratch/runs/20261005-dredmor-lazy-retry-recovery` contains37 hashed entries/38 files,97 verified served pins, source45e3f361 and module40cc834b. Browser87522 closed normally11:35:21.852Z with both resources closed and no cleanup errors. No gameplay/FPS claim.

The private server returned503 for exactly the first three GETs for `game/game/manTemplateDB.xml`, Range bytes0-6562. First failure was delayed2500ms; next two were immediate. This exhausted **host._fillParkedRead** retries (host.js689–699,250/500ms backoff); ChunkCache.fill itself has no retry. Earlier references to provider preload retry describe a different path. No engine/provider behavior was modified.

At37664/40418/40922ms the target requests failed503 with zero body bytes. `after-retry-exhaustion.png` visibly names the file/HTTP503 and offers Retry/Quit. Ordinary pointer click663,422 held150ms (55047–55203ms) activated Retry. Fourth identical request at55203ms succeeded206 with6563 original bytes. `after-user-retry.png` shows later file recipes_bg.png loading, then `menu-resumed.png` shows the normal menu. This verifies failure feedback, user Retry, unchanged-range retrieval and resumption. Quit is visible but was not clicked; screenshots provide only sampled timing, not an exact500ms threshold measurement.

Next task is a separate pristine300sec ordinary route through confirmed150ms New Game click, difficulty/skills/name and actual dungeon movement. The menu/setup evidence is not gameplay qualification.

## 2026-10-05 pristine ordinary dungeon reached, control follow-up pending

`scratch/runs/20261005-dredmor-release-dungeon` preserves52 hashed entries/53 files and97 actual served identities, source45e3f361/module40cc. No network fault or observer. Session28944 reached Level1 **The Annex of Muffins**, player sprite, health/mana HUD and map after normal launcher, New Game, default difficulty, Random skills, Codex name, two150ms story-page clicks and two welcome/tutorial OK clicks. `tutorial-dismissed.png` and `player-down.png` are actual dungeon imagery. Root independently reviewed the first.

Player control is still **unqualified**: two instantaneous ArrowDown presses after dialogs closed show no visible displacement. Earlier two presses occurred while the tutorial modal was open and prove nothing about movement. A planned floor click did not reach the helper before its300sec guard; inputs.json is authoritative. Browser/server closed11:43:01.309Z, errors empty, exit2 is the harness deadline rather than a game fault. No FPS/audio claim.

Most elapsed time came from review roundtrips. Next route batches the now-verified setup/story/dialog inputs, pausing at meaningful scene gates, then tests ordinary150ms held key presses or a150ms click on visible adjacent floor with before/after screenshots. The private helper uses Puppeteer keyboard.press delay, not guest-state writes or synthetic guest callbacks. Hypothesis that instantaneous keypresses are missed remains unproven.
