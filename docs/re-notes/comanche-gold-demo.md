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


## Root cause of the callback crash (claude:202b4b39, 2026-10-06)

**Not a stack or SMC bug: a startup race in the game that our slower CPU
loses.** The "ESP ~0x37A00 above the thread's stack top" is the timer thread
executing an invalid instruction head the mixer was patched with.

- The mixer `exe+0x40bfd5..0x40c414` is generated per channel. Its patcher
  `exe+0x40be48` (entered through `0x40be40`, called only from the DirectSound
  stream routine `0x4d11d0`, i.e. on the timer thread every 4th 33 ms tick)
  writes each channel's 2-byte head: `eb 3a` (skip) for an idle channel, else
  the 16-bit immediate at `0x40be4c`, `0x40be62`, ... In the file those
  immediates are the placeholder `0x7fff`; `exe+0x40c74c` (called once from
  `0x401ac7`) fills them with the real head `a1 c8` (`mov eax,[0x40a0c8]`).
  The channel flags at `0x40b6f9..` start as `0xff` (active).
- So the mixer is only valid once `0x40c74c` has run. `timeSetEvent(33)` is
  set at API #243 and the primary buffer is playing, so the first mix comes
  at the 4th tick, ~132 ms later. Main reaches `0x401ac7` only after
  ~2.76M blocks, half of it in `0x4d8650`: a linear scan of the CGOLD.PFF
  directory (32-byte entries) calling the static `_stricmp` at `0x4e0be0`
  ~95,000 times, one block per character. A Pentium does that in a few tens
  of ms. We take ~0.15 s at full speed (`--real-ticks`), or 138 batches of
  the default 200 ms/batch clock, so the first mix writes `ff 7f` (an FF /7
  head, invalid) and the timer thread runs off into garbage.
- Confirmed: `--watch-word=0x40be4c` shows `0x7fff -> 0xc8a1` at batch 139,
  while `0x40bff0` becomes `ff 7f` between batches 2 and 3. A watchpoint is
  checked on the main instance, so T1's write is attributed to main's current
  block (`0x4d867f`); the only code storing `0x7fff` there is the patcher.
- Pacing proves it: `--tick-ms-per-batch=1` (or 10 with `--batch-size=200000`,
  ~20M blocks per guest second) keeps T1 alive and the game reaches the
  briefing. `--no-mm-timer-thread` (callbacks only from the message pump) also
  avoids the crash but then deadlocks in the briefing's tick wait
  (`0x4bb8a4`), because that loop never pumps. `--real-ticks` and `--no-uop`
  still lose the race.
- Second CLI-only cost: in the briefing the main loop redraws the whole frame
  with GetDC/SelectPalette/RealizePalette/StretchDIBits/ReleaseDC on every
  pass while it waits for the tick (~10,000 per batch at tick 10). On the batch
  clock a host call costs no guest time, so this runs ~0.4 s of wall clock
  per batch. On real hardware and in the browser the time spent in the call
  paces the loop.

**What would fix it** (none done): make the pre-init work fast enough. Either
a decode-time fold for the byte-compare `_stricmp` loop (a two-stream scan;
`0x4e0bfc..0x4e0c08` is a SELFEXIT loop the matcher cannot see today), or a
per-app guest-clock dilation. The browser has not been tried: its clock is
real time, so it should behave like `--real-ticks` and lose by a hair.

Status 2026-10-06: parked again (claude:202b4b39) with the root cause above; TODOS NEW-GAME-COMANCHE-GOLD-DEMO-20261006.
