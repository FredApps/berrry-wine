# Dungeons of Dredmor — archived Windows Steam beta

Local candidate `dungeons-of-dredmor`, app `dungeons_of_dredmor`. This is a community-uploaded proprietary Steam beta, **not a verified demo, freeware release, or public redistribution grant**. It is in the local experimental selector and Role-playing corpus category, not DESKTOP_APPS.

## Source and identity

- Archive item: https://archive.org/details/dungeons-of-dredmor-beta-98811-steam2-builds
- Exact package: https://archive.org/download/dungeons-of-dredmor-beta-98811-steam2-builds/98811_8.7z
- Uploader describes Steam2 depot 98811 revision 8 dated December 27, 2011. This date is archive metadata, not an independently authenticated release version.
- Package: 147,086,215 bytes; SHA-1 `7b32f7689a7ab31e48fc253da435968c99455109` (matches Archive metadata); SHA-256 `191ac33d78863dbbe7ef62f0f30711ecaef6d3690d15a9a7623de99acecdcd9a`.
- Executable: `package/98811_8/Dungeons of Dredmor.exe`, Windows x86 PE32, image base 0x00400000, 1,568,768 bytes, SHA-256 `1f8556b915b270c9ceaab7090d3dced8641430a7d5bb8830b919daa8e0ce8ef9`. No version resource found; no semantic game version is claimed.
- Static 7-Zip extraction preserved all 6572 regular files (199049510 bytes). No native executable was run, and no executable/DLL was patched. Assets include game XML, sprites, dungeon/expansion data, fonts, music, and sounds.

## Reproduction

Run `node tools/fetch-candidate-corpus.js --id=dungeons-of-dredmor` (7z required), or `--prepare` for an already extracted fixture. The generated ignored `.wine-assembly-browser.json` mounts the complete asset tree, with all 15 bundled DLLs explicitly registered. Exact extracted-file SHA-256 hashes are recorded in the local `.candidate-source.json` from acquisition; it and the original source archive remain under the ignored candidate directory.

Ordinary local launch route: `/emulator/?app=dungeons_of_dredmor`. CLI route: `node test/run.js --app=dungeons_of_dredmor`. These are registered routes, not passing compatibility tests.

## Static dependencies and untested behavior

The EXE imports SDL.dll, SDL_ttf.dll, SDL_mixer.dll, SDL_image.dll, LIBEXPAT.dll, steam_api.dll, SHLWAPI.dll, KERNEL32.dll, USER32.dll, ADVAPI32.dll, and SHELL32.dll. Bundled libraries additionally import Win32 GDI, WINMM, MSVCRT/MSVCR80, Winsock and WLDAP32. SDL/media/expat dependencies and steam_api.dll are present, unmodified. Steam client availability and dynamic dependencies remain unknown; there is no Steam emulation/bypass added by this registration.

No emulator run has been performed for this addition. Startup, gameplay, screenshots, audio, controls, FPS, and public-release suitability are **unverified**. The next step is a separately scheduled bounded ordinary launch, capturing the first concrete startup result without changing Steam behavior. Raw acquisition metadata, member inventory, import tables and static receipt are in `scratch/dungeons-of-dredmor-acquisition-20261005/`.
