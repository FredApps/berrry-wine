# Dungeon Siege demo

Original installer: `test/binaries/win98-games-a-d/DungeonSiege-demo-D3D.exe`,
192188416 bytes, SHA256
`a501306cad88c0fc41f986d92109343d68ac79fc11aaa6611724d84be628f3f8`.
The CAB starts at byte464312, spans191706128 bytes and contains37 files totaling
206866962 extracted bytes. `tools/extract-dungeon-siege-demo.js` checks source
identity, cabinet entries, integrity and file sizes; extraction does not imply
Windows installation. Original `DungeonSiegeDemo.exe` is3608640 bytes, SHA256
`8df1ba314073f8e9e7b48c7ed0fd3a976b1dafb722bffcb41f613a4c60a421ab`.

The experimental local registration uses the extracted executable, original
BinkW32.dll and Mss32.dll, and a generated companion-file manifest. The GAS file
is required at startup; other companions load lazily. This is not a public app.

## Startup blockers

- ANSI resource enumeration and nested callbacks were fixed in main77cca122f.
  A fresh original run passed that chain and reached EIP`0x617fcc`, the original
  `jmp [0x6f521c]` import for KERNEL32.VerLanguageNameA, with language`0x0409`.
  Evidence: `scratch/runs/20261009T0003Z-dungeon-siege-verlanguage`.
- Mainbab6e2494 adds generic VerLanguageNameA/W. See
  [the API handoff](../../ops/handoffs/version-language-20261009.md) for contracts,
  source pins and passing tests. Fresh original browser run20261009T0110Z-dungeon-siege-lazy-rtf passes this
  blocker, then traps at EIP`0xc35ac0`: fs_create_file_result opens lazy
  EULA.RTF (6532bytes), and its RTF stylesheet-expansion shim touches
  `entry.data` synchronously. The async-only provider throws VfsPendingError.
  Fix the generic file-open/RTF-consumer boundary; do not hide it with a
  blanket eager manifest or skip formatting only for lazy files.

The demo EULA window now renders; player-controlled gameplay is not qualified. Do not
count installer extraction or an API regression as gameplay, FPS or audio proof.
Older stopped-box evidence at bx_hgju4y2b is a separate recovery permission
boundary; newer fresh tests do not recover or overwrite it.

## Lazy RTF open fixed (2026-10-09)

Main b493bc3b9 parks CreateFileA/W while its RTF compatibility consumer loads
the file, preserving the original bytes and expanded read view. The unchanged
manifest still has1 eager and33 lazy companions. Original startup now displays
the EULA, with HTTP206 for EULA.RTF bytes0-6531. Capture:
`scratch/runs/20261009T0125Z-dungeon-siege-eula`; native tests:
`scratch/runs/20261009T0122Z-lazy-rtf-open`. Accept was not pressed because the
user instruction says not to answer approvals; an explicit decision was requested.
Browser56868/Chrome56883 exited0; temporary box stopped. This is startup progress,
not gameplay/FPS/audio qualification.
