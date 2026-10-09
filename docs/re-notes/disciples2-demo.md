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

At 04:21Z the serialized handoff controller PID234050 was started on the
same temporary box. It waits for browser189048 and its Chrome process to
exit, requires the browser cleanup receipt, verifies the probe hash, then
starts that one bounded probe. It does not stop BW2 or click installer controls.
It expires at 05:12Z; pending handoff can be cancelled by creating
`/home/user/disciples2-queue-20261009/cancel` on the boat. Do not separately
launch the installer while this controller owns the queued start.
State/logs: `/home/user/disciples2-queue-20261009/`; local controller and
launch receipt: `scratch/disciples2-preflight-20261009/after-bw2.js` and
`queue-launch.json`. Controller SHA256:
`2402e54a823b35bfc2e91c28d72636c63abe89fae3936c76d126bc512d90ccc2`.

Static `tools/unimplemented-imports.js` audit against main420da0745 reports
70 imports and no missing/explicit fail-fast handlers. This excludes dynamic
imports and the extracted payload, and does not prove handler correctness or
successful installation. Raw audit and checked probe API contract are retained
in the same local preflight directory.

## 2026-10-09 ordinary Wise installer progression

Original Wise bootstrap reaches initializing splash, self-loads glc1.tmp at507000, then Welcome. Reviewed ordinary Next progresses through Choose Destination Location, Select Program Manager Group, and Start Installation; no agreement appeared. Captures/logs retained in runs20261009T0510Z-disciples2-welcome, 20261009T0511Z-disciples2-destination, 20261009T0512Z-disciples2-program-group and 20261009T0512Z-disciples2-start-install. The group-page probe's title matcher missed that page and exhausted a finite10000-batch budget; no guest hang inferred.

Installer272256 started05:12:49Z on bx_75agndxm with180s guard and ordinary Next on the reviewed Start Installation page. Output /home/user/disciples2-install-20261009; save-vfs targets /home/user/disciples2-installed-vfs-20261009. It was confirmed live at the next process check. Collect actual termination before claiming extraction or launch; no game screenshot yet.
