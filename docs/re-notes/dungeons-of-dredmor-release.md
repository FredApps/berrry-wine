# Dungeons of Dredmor — archived public Steam release

Separate local candidate `dungeons-of-dredmor-release`, app `dungeons_of_dredmor_release`. The existing `dungeons-of-dredmor` / `dungeons_of_dredmor` beta remains intact. Both are experimental, excluded from the public desktop, and categorized Role-playing.

## Provenance

[Archive.org Steam2 collection](https://archive.org/details/steam2-dump) supplies [steam2.torrent](https://archive.org/download/steam2-dump/steam2.torrent), not individual HTTP game payloads. Torrent SHA-256: `d2ec7dc41b15995ec36d16a35e15bccd4694f7d50e5c0cfa4ef997fc17943fd8`; infohash `0f3e7a75c0f885dde481054d4bcd8cd14eab51c8`. Only the selected depot was retrieved; the multi-terabyte archive was not downloaded.

The [archive depot catalog](https://github.com/dr3murr/steam2-winfsp/blob/main/data/depot_labels.tsv) distinguishes public-game depot98801 from beta98811;98810 is the beta app, not the retail depot. The decoded manifest itself identifies depot98801 revision17 and includes the Windows PE32 game executable. The [dated catalog](https://github.com/extremebleem/steam2_downloader/blob/main/Steam2Browser/index.bin) records its exact SHA-matched head blob at `2012-08-29T11:48:34.606Z`. That is archival timestamp evidence, not an independently authenticated semantic game version. The executable has no version resource.

Selected source closure:18 blobs,16 DATs (315,182,086 DAT bytes). Every source file SHA-256 matches its torrent filename; each parent CRC was resolved, the DAT matched its blob-declared size, and every extracted file length matched the final manifest. Original Steam2 container chunks were decoded with their archived AES-CFB/zlib format; no game executable, Steam DLL, API behavior or authentication check was patched. All6270 files (252,942,500 bytes) are preserved, including additional platform files and the mod validator; the registered route selects the Windows game.

`Dungeons of Dredmor.exe`:2,105,344 bytes; SHA-256 `50260373b54d6451683b2f175c9e3ae7f773ea9f0814baaf48e7f42e953ce1fc`. It differs from the preserved beta executable. Exact source paths/hashes and all output file hashes are in ignored `test/binaries/candidates/dungeons-of-dredmor-release/.candidate-source.json`. Original blobs/DATs remain in its `sources/` directory. Acquisition/parser sources, plan, catalog timestamp and download receipts: `scratch/dungeons-of-dredmor-release-20261005/`.

## Local preparation and limitations

The candidate is manual: generic fetch-candidate-corpus cannot decode Steam2 delta archives. Restore the exact closure using the published archive format/tooling, then run `node tools/fetch-candidate-corpus.js --id=dungeons-of-dredmor-release --prepare`. The generated manifest mounts all6269 companion files. Ordinary registered route: `/emulator/?app=dungeons_of_dredmor_release` or `node test/run.js --app=dungeons_of_dredmor_release`.

Direct game imports: SDL.dll, SDL_ttf.dll, LIBEXPAT.dll, steam_api.dll, OpenAL32.dll plus Win32 KERNEL32/USER32/ADVAPI32/SHELL32/SHLWAPI/comdlg32/dbghelp. The five non-system direct DLLs are explicitly registered and present; all other bundled dependencies remain in the full manifest. Managed mod-validator DLLs are preserved as assets rather than eagerly loaded into the game.

This is an archived commercial release, not a demo, cracked repack, or public redistribution approval. The presence of steam_api.dll alone does not establish a Steam-client requirement. No native executable or emulator was run. Startup, compatibility, screenshots, controls, audio and FPS remain unknown.
