# Original Age of Wonders II beta demo: main menu, gameplay blocked

Task `NEW-GAME-AGE-OF-WONDERS2-DEMO-20261008`. Sole worker, no subagents.
Isolated `/home/user/aow2-demo-20261008`, branch `fix/aow2-demo-20261008`, fetched
base `0d781689e8782fd6d0bce43e9021c749e6a30577`. Shared HEAD/index untouched.
Root reviews, integrates and pushes; worker does not merge/push/deploy.

Generic repair commit: `8833a3c0e` (eight explicit files). Append-only API 4475
implements real `SysReAllocStringLen`, including counted UTF-16, aliased source,
terminator, old-BSTR release and failure preservation. OLEAUT32 ordinal 5 is
mapped in both resolvers. The corrected real-dispatch test traps before and
passes after. Initial harness import-name typo is retained separately.

**Root's valid-length heap-OOM case is added but unexecuted.** Its request was
noticed after the native deadline and remote cleanup. Original executed test
covers overflow refusal, not actual allocator failure. Review/run the expanded
case before treating all branches as verified. The handler code itself is the
same code used in the passing regression and repaired browser module.

Registration includes a distinct local candidate, picker option, explicit
Borland package closure, original asset manifest generator, SHA/CRC-checked
local-only extractor, strategy category and a conservative corpus assessment.
`test/test-win98-games-a-d.js` includes the original 1,059 companion-file count.
Full test hit an unrelated missing Broken Sword manifest in this isolated
checkout; scoped AoW II registry/picker/assets/path/size checks passed instead.

Original package SHA-256:
`1244f0114965d011d1e28b97e207db15c902d124ebb25af8a6c97748beb73dc0`,
101,537,511 bytes. Original `AoW2.exe` SHA-256:
`a10590e5dbd013d154b00ea53e66670f4e74d38ab33adb2523f0a662af8f89f7`.
Full unchanged 1,063-file/197,002,538-byte ZIP extraction is durable at
`/home/user/wine-assembly/test/binaries/win98-games-a-d/Age of Wonders2 demo-SW/extracted/`.
All 1,063 local hashes match the remote source receipt. Remote-generated
1,059-file `.wine-assembly-browser.json` was copied exactly and its scoped
generator check passed. Worktree fixture is an ignored symlink to that owned
shared tree. No proprietary file is committed, no installation/configuration
state is asserted, and the original configuration program was not run.

Sealed runs, written last in the shared dashboard checkout:

- `20261008T1518Z-age-of-wonders2-demo-before`: 35 indexed files, 24,752,669 bytes;
  result SHA `420999961c73ff03f1f0e5c6b124399712ab6a149e65fffeaf59536a4f705f89`.
  Reviewed actual initial unimplemented API crash. Loaded module `d8d4096f…c68960`;
  baseline module bytes were not retained, and are not guessed from current build.
- `20261008T1518Z-age-of-wonders2-demo-after`: 80 indexed files, 30,249,163 bytes;
  result SHA `ed5992bd51289454ed4028a41e046139992cb29e3d1b641c37288d6268d41423`.
  Fixed loaded/served module
  `e4d59e88c62dd17cafaa836120e35e891cd56b497bd80190c980696adc98396c`.
  Reviewed original splash, ordinary Worker main menu, later main-menu return
  after a normal Scenario click, and redraw after a 180 ms click. The held
  click's eventual outcome is unknown: no later image was captured.

All indexed SHA-256s verified; own run containment audit: two runs, zero errors,
zero missing references. Each run contains source archives/identity receipts,
original game executable, complete asset hash receipt, actual commands/logs,
browser/backend identity, named reviewed images and cleanup evidence. After
also retains the actual fixed module and both tested/expanded test source
versions. No gameplay image allowlist or gameplay qualification was added.

Observed limit: cooperative main thread remains at VCL50 `0x00ac63b4`, yield7,
main/focus HWND `0x10002`, three active guest threads and pending timer. Ordinary
input is recorded. Normal Worker route reaches the main menu with four guest
Workers, but Scenario → Single/setup/gameplay was not observed before the
unchanged guard. Snapshot ownership (hidden main form `0x10003`, visible child
`0x10004`) is an investigative lead only. The runtime omitted standard
`stdole2.tlb`, registered OLEAUT32/COMCTL32 DLL payloads and dynamic OLEPRO32;
built-in APIs were used, and their relevance to the menu behavior is unknown.
No forced guest state, targeted message injection or silent-success replacement.

Canonical native gates PASS within original 15:04:37.274 deadline. Missing two
checked-in ToyVM bundles were supplied inside that deadline. JS syntax,
API append-only/freshness, dispatch freshness, ordinal5 host resolution,
manifest freshness and scoped original registration checks PASS. FPS/audio are
unknown and unclaimed. Age of Wonders I remains distinct and untouched; no
earlier second-title gameplay qualification was found. **No new-game credit.**

Temporary no-env boat `bx_997uef9b`, expiry `2026-10-08T16:47:45.876Z`, root
adopted lifecycle. Browser PIDs 40802 then 45335 never overlap. Fixed gameplay
guard 15:15:38.887 was retained across repair and ordinary route navigation;
final Chrome exited0 at15:15:39.001 (114 ms close overhead). Browser active
41.459 + 680.946 s. Transfer313.438 s. Installer phase unused.

4,329,217-byte output archive SHA
`86ea6ba0211ab657978920725b17dd081fc6812064cef9605cc75e6acd8c0df5`
retrieved and verified before removing owned remote prefixes/archives
15:18:05.554; retrieval/cleanup5.486 s <180. All eight owned process IDs and
Chrome absent; exact preflight listener baseline restored; 3,569 runtime source
pins match before removal. Root may stop the boat. Local disk remains >2 GiB.

Next: review the expanded heap-OOM assertion, then diagnose original Scenario
input/ownership and missing declared system support under separately authorized
limits. Worker performs no more runtime, no other title, no held diagnostics,
no Claude panes, no config/public deployment, no refill. EXIT after scoped commits.

## Coordinator integration review, 2026-10-08

The historical unexecuted-test limitation above is superseded by the separate
native review at 15:46:34–15:46:37 UTC on temporary box `bx_997uef9b`.
The expanded actual-allocation-failure regression exited 0 with Node24.18.1.
Root matched both test and handler SHA-256 against commit8833a3c0e; the
repair is pushed on main as `d72fc8abe`. Receipt retained at
`scratch/runs/20261008T1546Z-age-of-wonders2-demo-native-review/remote-receipt.json`.
Root verified all10 sealed native-review artifact hashes before checkout retirement.
Continuation source828f1d119 is archived on GitHub as archive/wt-aow2-demo-20261008;
ignored work artifacts are preserved under scratch/retired-worktrees/aow2-demo-20261008.
Root independently verified all35 before and80 after indexed hashes, all1063
original extracted-file hashes, manifest freshness/1059 files, local-only registry,
picker and explicit Borland packages. The broad A–D suite remains unverified
because of the unrelated missing Broken Sword manifest described above.
Scenario/gameplay remain unqualified. Registration integration does not alter
the exact tested runtime source or deploy the public site.
