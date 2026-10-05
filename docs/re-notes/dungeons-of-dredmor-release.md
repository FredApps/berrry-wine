# Dungeons of Dredmor — archived public Steam release

Separate local candidate `dungeons-of-dredmor-release`, app `dungeons_of_dredmor_release`. The existing `dungeons-of-dredmor` / `dungeons_of_dredmor` beta remains intact. Both are experimental, excluded from the public desktop, and categorized Role-playing.

## Provenance

[Archive.org Steam2 collection](https://archive.org/details/steam2-dump) supplies [steam2.torrent](https://archive.org/download/steam2-dump/steam2.torrent), not individual HTTP game payloads. Torrent SHA-256: `d2ec7dc41b15995ec36d16a35e15bccd4694f7d50e5c0cfa4ef997fc17943fd8`; infohash `0f3e7a75c0f885dde481054d4bcd8cd14eab51c8`. Only the selected depot was retrieved; the multi-terabyte archive was not downloaded.

The [archive depot catalog](https://github.com/dr3murr/steam2-winfsp/blob/main/data/depot_labels.tsv) distinguishes public-game depot98801 from beta98811;98810 is the beta app, not the retail depot. The decoded manifest itself identifies depot98801 revision17 and includes the Windows PE32 game executable. The [dated catalog](https://github.com/extremebleem/steam2_downloader/blob/main/Steam2Browser/index.bin) records its exact SHA-matched head blob at `2012-08-29T11:48:34.606Z`. That is archival timestamp evidence, not an independently authenticated semantic game version. The executable has no version resource.

Selected source closure:18 blobs,16 DATs (315,182,086 DAT bytes). Every source file SHA-256 matches its torrent filename; each parent CRC was resolved, the DAT matched its blob-declared size, and every extracted file length matched the final manifest. Original Steam2 container chunks were decoded with their archived AES-CFB/zlib format; no game executable, Steam DLL, API behavior or authentication check was patched. All6270 files (252,942,500 bytes) are preserved, including additional platform files and the mod validator; the registered route selects the Windows game.

`Dungeons of Dredmor.exe`:2,105,344 bytes; SHA-256 `50260373b54d6451683b2f175c9e3ae7f773ea9f0814baaf48e7f42e953ce1fc`. It differs from the preserved beta executable. Exact source paths/hashes and all output file hashes are in ignored `test/binaries/candidates/dungeons-of-dredmor-release/.candidate-source.json`. Original source path/size/hash inventories are retained. The redownloadable blobs/DAT cache was retired on2026-10-05 after all6,270 extracted file hashes were verified; live game payloads remain. Deletion receipt: `scratch/dredmor-lazy-20261005/source-cache-retirement.json`. Acquisition/parser sources, plan, catalog timestamp and download receipts: `scratch/dungeons-of-dredmor-release-20261005/`.

## Local preparation and limitations

The candidate is manual: generic fetch-candidate-corpus cannot decode Steam2 delta archives. Restore the exact closure using the published archive format/tooling, then run `node tools/fetch-candidate-corpus.js --id=dungeons-of-dredmor-release --prepare`. The generated manifest mounts all6269 companion files. Ordinary registered route: `/emulator/?app=dungeons_of_dredmor_release` or `node test/run.js --app=dungeons_of_dredmor_release`.

Direct game imports: SDL.dll, SDL_ttf.dll, LIBEXPAT.dll, steam_api.dll, OpenAL32.dll plus Win32 KERNEL32/USER32/ADVAPI32/SHELL32/SHLWAPI/comdlg32/dbghelp. The five non-system direct DLLs are explicitly registered and present; all other bundled dependencies remain in the full manifest. Managed mod-validator DLLs are preserved as assets rather than eagerly loaded into the game.

This is an archived commercial release, not a demo, cracked repack, or public redistribution approval. The presence of steam_api.dll alone does not establish a Steam-client requirement. No native executable or emulator was run. Startup, compatibility, screenshots, controls, audio and FPS remain unknown.

## 2026-10-05 lazy manifest startup diagnostic

Known-size on-demand manifest preparation now marks6248 data assets lazy and21 native/font files required. Private ordinary browser source1878f5ca/e227 and module3a65a4f1 reaches guest execution without6269 eager requests:29 game-route requests,0HEAD and0lazy-data reads before a trap at1128ms. The observed API is **SHLWAPI.PathAppendW**, block EIP4ccfe7, call instruction4ccff1 through IAT5a6350. It appends UTF16 string5b9dd0 (`Gaslamp Games\\Dungeons of Dredmor`) to the Personal folder returned by SHGetFolderPathW. Next instructions call PathFileExistsW at4ccffc and conditionally SHCreateDirectoryExW at4cd00d; all three are absent from the current API table. Do not count the returned desktop as gameplay.

Raw/immutable evidence: scratch/runs/20261005-dredmor-lazy-startup-pathappendw and scratch/dredmor-lazy-20261005/attempt1. Private helper lacked binaries/ alias for msvcrt.dll fallback; this is a harness limitation, not missing corpus data, and was corrected/tested for future runs. No lazy read occurred before the trap, so wait/retry behavior is test-covered but not runtime-qualified here. No Steam requirement conclusion, engine patch, FPS or audible acceptance.

## 2026-10-05 private path-API repair: launcher and main menu

Scoped sourceee432681 on c12a57a6 adds real Unicode shell path handling and shared ANSI/Wide recursive directory creation. Actual-handler40-case regression and full private production gates pass. Module162478613568105d1420d1c63c4aff5bff4bd0f4fe777ce7bb19773c91d5ce41 clears the prior settings-directory trap. Ordinary attempt2 reaches the rendered configuration launcher and main menu, with1,437 successful lazy byte ranges to1,306 files and zero game HEAD requests. This is real on-demand loading evidence, not gameplay qualification. New Game was clicked near the180second guard; no later setup/control result was captured.

Evidence: `scratch/runs/20261005-dredmor-lazy-main-menu`; source/test limitations and exact identity distinctions: `ops/handoffs/dredmor-wide-path-apis-20261005.md`. Visible wait/retry UI, active gameplay and performance remain unqualified.

Merged45e3f361/module40cc834b ordinary attempt3 also naturally displayed the existing Loading window and automatically resumed to the main menu. Evidence: `scratch/runs/20261005-dredmor-natural-loading-ui` (27 hashed artifacts). No fault injection was used; actual failed-read Retry remains a separate pending diagnostic. New Game was clicked near the180second guard, so active gameplay remains unqualified. The apparent lack of setup after an instantaneous click is not yet a diagnosed game/input failure.

## 2026-10-05 transient range recovery and ordinary New Game input

Published immutable evidence: `scratch/runs/20261005-dredmor-transient-range-recovery` (37 hashed entries,38 total files including hash manifest;97 verified served source/assets pins). Source45e3f361/module40cc834b, runtime75629 exited0 with browser/server closed11:29:05.677Z, cleanup errors empty.

A private HTTP-only fault delayed the exact manTemplateDB.xml range bytes0-6562 by2500ms and returned503 once. The unchanged provider automatically retried255ms later and loading resumed into the menu. This did **not** exercise user Retry: provider defaults to two retries (three attempts total), so the prepared next diagnostic must fail exactly those three requests before allowing original bytes. Samples at142ms and946ms after request respectively show no overlay and Loading; they are sequential observations, not an exact500ms threshold measurement.

After recovery, one ordinary150ms held click on visible New Game reached **Choose Your Difficulty** (`new-game-held.png`, root independently reviewed). This is setup/input evidence, not player-controlled gameplay, and comes from a fault-recovered diagnostic rather than a pristine route. It disproves a blanket claim that New Game is unusable; previous instantaneous clicks remain insufficiently diagnosed. Next ordinary route uses the verified hold and advances difficulty/skills. No FPS/audio claim.
