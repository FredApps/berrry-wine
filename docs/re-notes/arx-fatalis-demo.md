# Arx Fatalis demo: original local-media preparation

Source-only lane `NEW-GAME-ARX-FATALIS-DEMO-20261007`. No guest launch,
installation, gameplay or release qualification yet. Current-main registry,
public desktop list, task history and retained run names were checked before
selection; no Arx entry or prior player-control qualification was found.

Original local source:
`test/binaries/win98-games-a-d/Arx_Fatalis-demo-D3D-Glide/`.
17 regular files total164,537,198 bytes, read in place. `Setup.msi` SHA256
`dabbf8e13cbdab342621712bb85fdb863e0122e1b9e4c3bf073cfc3dde2b9a5d`;
`bin/ARX.exe` SHA256
`ebd3e2b3b14b678ea70e7aed58daf2ba5eb4d6681a3ea294e603228f84d27aa7`.
The MSI reports ProductName Arx Fatalis, ProductVersion1.0.0 and product code
`{96443F45-13E2-11D6-AC87-00D0B7A9E540}`. These identify installer metadata,
not an independently verified executable version or license.

## Exact static installation closure

The repository's `tools/msi-tables.js` decoded File/Media/Component/Directory
and Registry tables; `7z l -slt` listed each original cabinet without extracting.
12 MSI file rows map to `C:\Program Files\JoWood\Arx Fatalis`:

| Source | Installed target | Uncompressed bytes |
|---|---|---:|
| Setup1.cab | data.pak | 110965070 |
| Setup2.cab | SFX.pak | 31995270 |
| Setup3.cab | SPEECH.pak | 39758530 |
| bin/ARX.exe | ARX.exe | 3166261 actual |
| bin/Athena.dll | Athena.dll | 180224 |
| bin/LOC.pak | LOC.pak | 195248 actual |
| bin/data2.pak | data2.pak | 1696636 actual |
| bin/Arx.ttf | misc/Arx.ttf | 36992 |
| bin/Logo.bmp | misc/Logo.bmp | 921654 |
| Three original Internet.url files | Same names at install root | 250 total |

All source members/loose files exist. The three large PAKs are **not installed**;
they remain compressed. Selective extraction would require182,718,870 additional
bytes (about174.25MiB), plus small metadata. Do not duplicate existing loose
payload or unpack all original media. MSI source-directory mapping uses `bin`,
while target `misc` contains font/logo. Preserve original bytes: stale MSI
FileSize values say33 for ARX.exe,194572 for LOC.pak and1640420 for data2.pak;
these do not justify truncating or replacing the original loose files.

MSI Registry sets HKLM `Software\Arkane Studios\Installed Apps\arx fatalis`,
value `Folder` to `[INSTALLDIR]`. `Action_EAX_install` (type114, condition
`NOT Installed`, sequence6650) references `.\autorun\redist\EAXUnified.exe`,
which is absent in the supplied tree. This installer-side dependency remains
explicit; no claim of a complete successful original installer. ARX imports
DDRAW, DINPUT, WINMM, COMCTL32, KERNEL32, USER32, GDI32, COMDLG32, ADVAPI32,
SHELL32, OLE32 and original Athena.dll. Athena directly imports KERNEL32,
USER32 and OLE32; dynamic audio/device requirements remain runtime-unknown.

Next: review a bounded selective three-CAB extraction/byte-hash receipt and
faithful12-file layout, then local-only manifest/registry recipe and ordinary
menu/new-character/world input route. No engine changes or runtime grant are
implied by this inventory. No fabricated saves, config overrides or EAX success.

Detailed receipts (ignored local evidence):
`scratch/wt-diehard-20261007/scratch/arx-fatalis-preparation/install-plan.json`,
`msi-tables.json` and three `SetupN.cab.listing.txt` files.
