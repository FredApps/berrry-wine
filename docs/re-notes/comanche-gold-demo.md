# Comanche Gold (demo) -- PARKED

NovaLogic, 1998, software voxel renderer. Fixture:
`test/binaries/win98-games-a-d/Commanche Gold-DEMO-SW.EXE` (InstallShield
self-extractor, an IS5 Disk1).

## Install (works, headless)

- `7z x` the SFX; run the 16-bit `SETUP.EXE` with `--vfs-include='*'
  --capture-launch=cap --tick-ms-per-batch=5`. At the default 200 ms/batch
  its splash WM_TIMER (id 0x3e9) fires before `_INST32I.EX_` is expanded,
  the launcher posts WM_QUIT and reports "Setup is unable to decompress and
  copy all of the program files".
- Stage 2: `_ins0576._mp` from the capture (`--exe-guest-path` +
  `--vfs-tree=cap`), Next, Next, it copies, "Installation ... complete",
  Finish. Installed tree (8 files, 17 MB: demo.exe, cgold.pff, netsock.dll,
  msvcrt.dll, wsetup.cfg, ...) kept at
  `Commanche Gold-DEMO-SW/installed`; it must mount at
  `C:\Program Files\NovaLogic\Comanche Gold Demo\` (the game changes into its
  install directory and opens CGOLD.PFF relatively; `netsock.dll` is a static
  import).

## Game

Boots to the Pilot Roster -> Duty Roster -> Gold Operations -> Swift
Justice -> Delta Patrol briefing (keyboard Enter). The briefing never
advances, because the main loop busy-waits on a tick counter
(`exe+0x4bb8a4`: `cmp ebx,[0x4e76f0]; ja` -- 4 ticks) that only the 33 ms
`timeSetEvent` callback (`exe+0x4d95a0`, periodic) advances.

The callback dies after 7 ticks, the same way on the winmm timer thread
(default) and injected on the main thread (`--no-mm-timer-thread
--async-mm-timer`): EIP=0 from a `ret` at `exe+0x40c414`, ESP ~0x37A00 above
the thread's stack top. Every 4th tick it calls `exe+0x4d11d0` (DirectSound
streaming: IDirectSoundBuffer::GetCurrentPosition, then a mixer); the
routine `exe+0x40bfd5..0x40c414` is generated code (`exe+0x40be5b` stores
into `0x40bff0`, rewriting a `mov eax,[0x40a0c8]`) and keeps registers in
globals (0x40a0a0..0x40a0c8). Not the uop tier (`--no-uop` same), no
code-write retirements (`--trace-code-writes`: the patch lands before decode).
Mounting a wsetup.cfg with MMX=0 or sound=0 (`--vfs-mount`) did not change
it either (override not verified to take effect).

**Next step:** an instruction-level ESP trace across one 4th-tick callback
(`--trace-at` on `exe+0x4d11d0` and the mixer's entry) to find where ESP is
repointed and why it is not restored.

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-COMANCHE-GOLD-DEMO-20261006.
