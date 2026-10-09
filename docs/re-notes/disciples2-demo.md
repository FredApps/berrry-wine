# Disciples II demo

## Original and first preflight (2026-10-09)

`test/binaries/win98-games-a-d/Discipless2_demo-D3D.exe` is143,913,296bytes,
SHA256 `e37753c2319380a933fb105b28639d5cacb2ed429731f5ae53706f047c8d03b0`.
`file` identifies PE32 GUI Intel80386, four sections. Static ASCII strings
include `WiseMain`, the Wise0132.dll extraction CRC error,
`Disciples II Demo Installation`, and `Initializing Wise Installation Wizard...`.
These identify a Wise installer; exact engine version is not established.
`7z l` (7-Zip23.01) cannot open it as an archive. Do not treat that as a bad
installer or assume a CAB/InstallShield payload.

No Disciples II registration or qualified screenshot was found;
`disciples_demo` is the first game, not this candidate. Installed files and
manifest do not yet exist. No missing installed filename is established.

Pinned original was transferred and SHA256-verified on temporary bx_75agndxm at
03:46:00Z as
`/tmp/disciples2-original.exe`; receipt is
`scratch/disciples2-preflight-20261009/transfer.json` with remote checksum.
The next runtime step is installer inspection/extraction after the serialized
Black & White 2 browser finishes. No second emulator or benchmark is running.
Respect any installer approval/license decision rather than answering for user.

Prepared next step: `/tmp/disciples2-probe-installer.js` (SHA256
`46e74f0d6c8152020916ea79b5397a705b4a9b220cd5ed16c07d40f162326f0d`).
It refuses to run while BW2 browser189048 is alive, has a180second hard guard,
and captures the first visible installer window without button input. Syntax
and upload checksum checked; it has not executed the installer.
