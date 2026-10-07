# Command & Conquer: Tiberian Sun demo

## Refill selection and original closure, October 7

Darkstone was excluded after recovering its existing controlled Town captures;
Tiberian Sun replaces that lane. Latest remote main
`1fba75144006e74fd44efd396ecb59e1260c417d` has neither title in `DESKTOP_APPS`
and no Tiberian Sun APPS registration. Retained board entries from October 6
record a live main menu and a grey campaign panel, not qualified gameplay.
The old resource wait for a temporary boat is resolved by the current remote
queue; no user pause is inferred from its superseded priority handoff.

The original self-extracting archive is
`test/binaries/win98-games-a-d/CnC-TiberianSUn-ts_demo-SW.exe`; its existing
26-file extraction is `CnC-TiberianSun-demo-SW/extracted/`. A read-only ZIP
catalog audit verified every extracted file's size and CRC against the
original archive. SHA-256 pins are retained for all files and the archive in
`scratch/runs/20261007-tiberian-sun-preparation/original-fixture-closure.json`.
Original `SUN.EXE` is 3,256,592 bytes, SHA-256
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
The original readme explicitly permits launching Sun.exe after extraction;
no invented installer registry or settings are required by this preparation.

## Prepared ordinary browser environment

Reuse exact existing source `0cbc1c6ffd997f5ab31142b4f2d9d57b318d05c6` and module
`7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`.
Only a private app registration overlay differs. There is no emulator fix,
guest patch, asset replacement or settings change. The normal recursive DLL
graph includes the game's BLOWFISH.DLL and native OLEAUT32/COMCTL32; the
available system `stdole2.tlb` is included. SHELL32/OLE32 have no native URL in
the normal registry; their ordinary WAT fallback remains intact. All 26
payload files, these two system DLLs and the TLB form 29 fixture pins, alongside
326 source/module pins. Full graph probes and hashes are in the contained
preparation run's `loader-closure.json`, `browser-pins.json` and `READY.json`.

Offline LANGUAGE.DLL dialog decoding identifies original main-menu template
226: Exit Game 1006 at y117; New Campaign 1559 at y12; Load Mission 1561 at
y33; Multiplayer 1562 at y54; Intro 1003 at y75; Options 1372 at y96.
Campaign template 148 contains list 1109, OK 1, Cancel 2 and difficulty slider
1295. These are resource units, not reviewed screen coordinates. The prior
owner corrected the hit-test hypothesis: New Campaign was delivered as
WM_COMMAND 1559; the grey campaign panel and displaced captions still need
actual current-run evidence before attributing a generic defect.

Remote transfer and execution await an explicit coordinator grant after
Antara and corrected Winamp on `bx_d8nw3e8t`. The prepared driver enforces a
600-second session, 2 GiB disk floor, current personally reviewed screenshots
before ordinary clicks/held keys, and terminal browser/server cleanup. No
gameplay or FPS qualification follows from this source preparation.
