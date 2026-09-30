# Caesar III demo

## Payload

The playable payload is produced by the original Sierra/Impressions demo
installer chain documented in `sources.md`:

```text
caesar3.exe (ZipMagic wrapper)
  -> setup.exe (Win16 bootstrap)
  -> _ins5176._mp (InstallShield engine)
  -> installed/c3.exe + SMACKW32.DLL + 112 data/audio files
```

The launcher mounts that installed tree through the `caesar3_demo` manifest.
It does not substitute files extracted outside the installer workflow.

## Name entry

The demo copies `The new governor` into its 32-byte player-name buffer at
`0x57eb3c`. Its capture initializer at `0x49f7b7` computes length 16 but leaves
the capture cursor at zero with overwrite mode enabled. The first five typed
characters therefore produced `Codexew governor`.

`lib/app-profiles.js` verifies the original instruction bytes at `0x41607d`
before replacing only that default-name copy with a bounded 32-byte clear. The
patch applies to the loaded image, not the installer-produced file on disk. A
different `c3.exe` is rejected by the expected-byte check.

## Gameplay gate

`test/test-caesar3-gameplay.js` launches one headless CLI process with frozen
stdio control and the CLI's own `--max-seconds=90` bound. It drives:

```text
title -> Start new game -> type Codex -> Continue
      -> Assignment 1 briefing -> To the city -> live city
```

Mouse presses retain separate down/up execution slices because Caesar samples
button state from its frame loop. The test asserts that the live name buffer is
exactly `Codex`, captures the name screen, then verifies the final 800x600 city
by its terrain/control-panel regions. Set `CAESAR3_NAME_SCREENSHOT` and
`CAESAR3_SCREENSHOT` to retain both PNGs.

## Hot loops (handler-hist, 2026-09-19)

`node test/run.js --app=caesar3_demo --no-build --quiet-api --max-batches=900
--batch-size=100000 --handler-hist --handler-hist-thread=0,0,0
--handler-hist-start=300 --handler-hist-stop=900 --hist-json=F --no-close`
writes three windows; `tools/loop-class-share.js F --exe=...c3.exe` attributes
each hot block to the loop containing it.

| VA | window 300-500 | window 500-700 | what it is |
|---|---|---|---|
| `exe+0x49e9ca` | **27.96%** | not in top | indexed byte `memcpy`, `i` spilled to `[ebp-0x4]`, bound `[ebp+0x10]`, src `[ebp+0x8]`, dst `[ebp+0xc]` |
| `exe+0x417204` | 7.86% | **45.98%** | per-frame logic, no load/store/advance shape |
| `exe+0x4a3ebc` | 29.56% | — | |
| `exe+0x40f407` | 6.15% | — | inside the `0x40f6d9` RLE sprite ladder already folded by `RLE_RUN` H424 |

**The two windows disagree strongly about where the time goes**, so quote a VA
with its window or not at all. Both windows are dominated by loops the current
self-loop matcher cannot see (~59% and ~88% of block entries) — see §22 of
[loop-idiom-superops-design.md](../loop-idiom-superops-design.md). Windows at
batches 500 and 700 came back byte-identical, which is the determinism holding,
not a sampling error.

## The unrolled tile blit and the uop tier (2026-09-29)

`exe+0x41ceb0` is the function that runs the RECT_RUN fold (H427, switch
`--no-fold=rect-run`). It is wrapped in `pushad` (`exe+0x41ced7`) and `popad`
(`exe+0x41e085`), and its body is two fully unrolled copies with no loop:

- **Top half: `exe+0x41cf0f`..`exe+0x41d799`.** About 467 straight
  instructions, `mov eax,[esi+k]; mov [edi+edx+d],eax` pairs with an
  `add edx,ecx` per row. The only branch is at the end:
  `cmp [ebp+0xc],4; jnz 0x41d7a0; jmp 0x41e085`.
  - The threaded decoder cuts this run into blocks at `exe+0x41d002`, so that
    address is a block entry too, with the same entry count as `0x41cf0f`
    (153,872 in the window).
- **Bottom half: `exe+0x41d7a0`..`exe+0x41e085`.** About 470 straight
  instructions that fall straight into `popad`. There is no branch before the
  `popad`.

With the fold off, H421 (`copy32_ro_to_sib`, the pair these rows decode to) is
**67.3%** of every threaded dispatch in the gameplay window (72.6M of 107.9M,
batches 3500..end). With the fold on it is 9.8% (3.4M of 34.5M).

### Per-site verdicts

Measured with `--uop-census`, `--branch-clock` and the fold off, on the
`tools/uop-game-ab.js` c3 route (`CAESAR3_CITY_BATCHES=2000`).

| head | trace max 160 (default) | trace max 400 | `$UC_MAX_LOOP` 600 build, max 600 |
|---|---|---|---|
| `exe+0x41ceb0` (entry) | installed, retired poor: 256 enters, 256 blocks, exit `exe+0x41ced7` (`pushad`) | same | same |
| `exe+0x41ced7` `pushad` | head-unsupported (op 60) | same | same |
| `exe+0x41cf0f` top half | **no-backedge** | **no-backedge** | **no-backedge** |
| `exe+0x41d002` top half, 2nd threaded block | no-backedge | **installed**, 397 insns, then **retired poor**: 256 enters, 152 blocks, exit `exe+0x41d7a0` | installed, 397 insns, retired poor: 256 enters, 160 blocks, exit `exe+0x41d008` |
| `exe+0x41d7a0` bottom half | no-backedge, `popad` at `exe+0x41e085` unsupported | same | same |

### Why no program ever covers either half

1. **The cap cuts a run that has no branch in it.**
   - A trace may leave only through a branch, and the trim step drops every
     non-branch member whose successor is outside the trace.
   - At 160, the top half's first 160 instructions contain no branch, so the
     trim removes all of them and the verdict is `no-backedge`.
2. **The top half needs about 467 instructions.**
   - `set_uop_trace_limits` silently clamps the maximum to `$UC_MAX_LOOP`
     (400), so asking for more gets 400.
   - Even a build with `$UC_MAX_LOOP` 600 still declines `0x41cf0f`. The most
     likely cause is the scan budget: `$UC_MAX_SCAN` (600) is exceeded, and
     the halved-span retry reports `no-backedge`. That was not instrumented
     further.
3. **The bottom half can never be a trace, whatever the cap.** It runs into
   `popad`, which the compiler does not support, before any branch.
4. **Even the part that compiles is retired as poor.**
   - `$uop_poor_check` retires a program when, after 256 enters, it has
     spent fewer than 2 blocks per enter.
   - Under `--branch-clock` a block is one executed branch. A straight-line
     trace that ends in one `jnz` can therefore never exceed 1 block per
     enter, however many instructions it retires (here 397 per enter).
   - So the rule retires a program for being straight-line, not for
     retiring little work per enter.
5. **Without `--branch-clock` (the CLI default) there is one more wall.**
   - The instruction clock also refuses any compiler block with more than 200
     instructions on one page (reason 7, `long-block`, 07e).
   - `test/test-uop-compiler.js`'s `trace-limits` case hit exactly this
     before it was switched to the branch clock.

The uop counters are identical with the fold on and off at the default cap:
828 installs, 44 kills, 8,040,181 enters, 243,860,426 blocks. The fold changes
only what the threaded fallback runs. So RECT_RUN stays (+37% user CPU
without it, see below), and uop taking this function would need all of the
following:

- `pushad`/`popad` support;
- a trace cap above about 470 instructions, with the scan budget and
  `UC_INSN` scratch (about 600 records at 256 bytes each) grown to match;
- a poor rule that counts retired instructions rather than branches.

On the same route (box2, `--branch-clock`, three interleaved runs each), fold
off, uop user CPU is 6.35 s at max 160 against 4.63 s with the fold on. A
larger cap recovers about 4% of that 37%: 6.11 s at max 400, which is the one
program at `0x41d002` running before it is retired, plus the rest of the
program mix. Full table: §19 of
[uop-tier-design.md](../uop-tier-design.md).
