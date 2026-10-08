# Age of Wonders (beta demo)

Triumph Studios / Epic / GoD, 1999. Tutorial plus one scenario ("The First
Conflict"). Registered as `age_of_wonders_demo`; version string 0.86.0140.

## Fixture and install

- Source: `test/binaries/win98-games-a-d/Age Of Wonder I demo-SW.EXE`, an
  InstallShield PackageForTheWeb wrapper (44 MB) around a Disk1 set
  (`setup.exe`, `_setup.dll`, `data1.cab`, ...).
- Installed headless in three stages, each child captured with
  `--capture-launch` because CreateProcess does not run a child in the CLI:
  1. `run.js --exe=<wrapper> --capture-launch=cap` -> `setup.exe /SMS`
  2. `run.js --exe=cap/.../setup.exe --args=/SMS --vfs-include='*' --capture-launch=cap2`
     -> `c:\windows\temp\_istmp1.dir\_ins5576._mp`
  3. `run.js --exe=cap2/.../_ins5576._mp --exe-guest-path=<same> --vfs-tree=cap2
     --control --frozen --save-vfs=inst --save-vfs-prefix='c:\program files'`,
     then Yes (licence), Next (destination), step until Setup Complete, quit.
  The tree (782 files, 93 MB) lives at `Age Of Wonders demo-SW/installed/` and
  mounts at `c:\program files\triumph studios\age of wonders beta demo\`;
  `node tools/gen-win98-games-a-d-manifests.js` writes its manifest.

## What it needed (2026-10-06)

1. **OFT-less imports (44b311d2).** A Delphi 3 app with runtime packages:
   `aow.exe` imports 19 `.dpl` packages and they import each other, all
   through Borland import descriptors with OriginalFirstThunk 0.
   `$patch_caller_iat` stopped at OFT == 0, so the EXE (mapped before any
   package, every slot a stub) was never bound: first call trapped as
   `UNIMPLEMENTED System.LoadResourceModule@83E68268`. Test:
   `test/test-dll-import-no-ilt.js`.
2. **OBM_CHECKBOXES (44b311d2).** VCL loads it at startup to size check boxes
   (id 32759 trapped in `$gdi_bitmap_create_system`).
3. **Low VirtualAlloc arena (`virtualAllocTop: 0x10000000`).** Loading the
   scenario span forever in `ilpack.dpl` `0x552111ea` (a colour-keyed 16-bit
   span copy) with ECX ~0x8FB02614. Cause: the record skipper at
   `ilpack+0x55211188` does `lea esi,[esi+edx+3]; and esi,0x0FFFFFFC`, which
   drops the top nibble of a pointer; Win9x never hands out heap above
   256MB, our top-down arena starts at 0x7F000000. Not the uop tier
   (`--no-uop` stalls the same). Test: `test/test-virtual-alloc-top.js`.

The packages must be seeded explicitly (`dlls` in `lib/apps.js`, VCL30
first): `resolveDllGraph` only follows dependencies whose names are in
`lib/dll-registry.js`.

## Route (CLI, default batch size)

Batch numbers from `scratch/runs/20261006-aow-demo-move/route.txt`:
300K first orb (crossed swords) -> Game Type; 340K "Single Computer" ->
Select a Map; 375K "first conflict.hsm", 389K Select -> scenario setup
(Elves = Human vs Halflings, Orcs, Goblins CPU); 423K Start! -> loading;
~700K "Gildesh, Let the game begin". Then: click the banner (briefing
book), click the bookmark (research book), pick a spell (Haste) -> map.
Click the party on the town (222,205) to select it (leader + 3 archers,
26 moves), click a hex (298,262) to plot the path, click it again to move.

Evidence: `scratch/runs/20261006-aow-demo-move`.

## Open

Audio (Galaxy Sound System, `galaxy.dll`; it imports ole32 which falls to
WAT stubs), FPS, the browser route.
