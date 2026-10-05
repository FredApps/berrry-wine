# Candidate: deliver a timer IRQ held for IF at the guest's IF-enable boundary

`candidate.diff` is a unified diff against the **stack tree**. It applies with `patch -p1` to the
output of `build-tree.js --tree=stack` (`git apply --cached --check` passed against that tree's
base).

**Nothing has been run:** no emulator, no test, no build. Only `node --check` was run on the
edited files. The WAT was reviewed by eye and has never been assembled.

The audit behind every choice here is `AUDIT.md` (same directory).

## What it changes (8 files under tools/toyvm)

| file | change |
|---|---|
| decode.js | `decodeOne` also returns `sti` (opcode FB) and `ssLoad` (8E with sr=2, or POP SS 17). No change to words or endsBlock. |
| compile.js | **IFEN: STI's shadow is laid out in the block loop.** The follower is always decoded inline: no jmp_syn, volatile cut, maxWords cut or wasm decoder inside the shadow. A transfer follower ends the block itself, never traced through. Otherwise the block ends with a new `jmp_ifen` to the boundary. `IFEN_ROOM` is checked before the STI. Under the trap flag's oneInsn the shadow is not laid out; it is laid out under the new `ifenShadow` option (µop-only's fallback). The `gsCharge` of `jmp_ifen` is 0, as for jmp_syn. |
| emit.js | `CONT` also refuses on `$ifarm`. New `jmp_ifen` (jmp_syn, plus `if $ifarm → EXIT('ifen')`). `EXIT_WHY.ifen = 11`. `sti` arms `$ifarm` iff `$irqpend && IF==0`; `cli` clears it. `popf`/`popf32` also hand back on `$irqpend && IF`. `iret`/`iret32` read `$irqwant | $irqpend`. STATE gains `irqpend` and `ifarm`. |
| dos-loop.js | `timerPending`, set only at a stop where the timer rung was blocked by IF alone, and dropped when the vector is unhooked. `set_irqpend` and `set_ifarm(0)` are written before each slice. After the slice: read exitwhy and ifarm, clear ifarm, compute `ifenExit`/`ifen`. The timer rung is also asked at an `ifen` handback, with `clockAt = dispatched` and the existing grid advance. No audio render or `setClock` is added. Schedule only. |
| region-jit.js | `buildRegion` declines `sti|popf|popf32|jmp_ifen`, and both block walkers stop at them. `GO_RE` is updated to the new CONT text. |
| uop-only.js | The STI fallback compiles with `ifenShadow`. `drive` returns on `$ifarm`; `mid` also accepts `jmp_ifen`'s pass-through. `iretMiss` reads `irqpend`, and `$exitwhy` is zeroed when drive runs on. |
| uop-harness.js | `irqpend`/`ifarm` added to NOT_GUEST and zeroed with `irqwant`. |
| trace-jit.js | `irqpend`/`ifarm` excluded from the arm fingerprint. |

### Eligible delivery instant (dos-loop.js `ifen`)

All of these must hold at the handback:

- under the schedule (`irqSchedule`);
- `timerPending` is set;
- the handback is early: `!atStop` and `left >= 0`;
- it is not a port-write cut (`cut < 0`) and not single-stepping;
- IF=1;
- `ifenExit`, meaning the exit was one of:
  - `ifen`;
  - `popf`;
  - `iret`;
  - `edge`/`ret`/`indirect`/`far32` with `$ifarm` up, i.e. the STI's follower was a transfer.

At a stop the existing rungs run unchanged, and they deliver anyway if IF=1. Keyboard, retrace,
GUS and the Sound Blaster's non-forced line still fire only at stops. They would follow the same
pattern later (one `xxxPending` each, the same `ifenExit`).

### Choices made, and how to change them

- **STI;MOV SS (and STI;POP SS) is UNCONFIRMED, informational only.** It is controlled by
  `compile.js IFEN_STI_MOVSS` (currently `true`).
  - No primary source states the combination. The only related statements are:
    - SDM Vol. 3A §7.8.3 p. 7-9: only the first of consecutive SS loads is guaranteed to inhibit;
    - SDM Vol. 3C §29.3.1.5 p. 29-14: VMX guest state never shows blocking by STI and by MOV SS
      together.
  - `true`: the boundary moves one instruction further, to after the instruction following the
    SS load. Both shadows are composed, which is the fixture's `sti_movss` oracle.
  - `false`: the boundary is right after the SS load. STI's shadow alone; the SS load's own
    shadow is not composed onto it.
  - Either value keeps every arm identical, because the boundary is still a block transfer.
  - The deferral happens only once; a second consecutive SS load does not extend it.
- **A separate `$irqpend`, not `$irqwant`.** The Sound Blaster's port-armed line keeps exactly
  its current boundaries (IRET and the next handback). It does not gain the new STI/POPF exits.
  Extending them to SB is a follow-up with its own A/B.
- **`cli` clears `$ifarm`.** STI;CLI then costs no handback. Without it, the boundary after the
  CLI would hand back with IF=0 and deliver nothing.
- **HLT is not an eligible instant in this cut** (AUDIT §8.5).
  - µop-only's drive runs straight past HLT's `end`.
  - HLT's `end` is indistinguishable from `end_cut`, unimplemented ops and TF steps.
  - Doing it needs a distinct exit (an `hlt` handler or an `EXIT_WHY.hlt`) and a µop-only change.
- **The host-serviced INT return** (dos-loop.js `serviceInterrupt`, a JS IRET) and **IRETD into
  V86** are not eligible instants in this cut (AUDIT §5).
- **Under TF** (`stepOne`): STI stays a one-instruction block, and an armed `end` is never
  eligible.
- **Port-write cuts** (`cut >= 0`) are not eligible for the timer. The forced SB line keeps its
  priority there as before.

### Costs

- **`CONT`: one `global.get $ifarm` and one `i32.or` on every block transfer** (GO, GO_LOOKUP,
  RET*, `$jlook_edge`). This is the one hot-path change.
  - The zero-instruction alternative is to carry `$ifarm` as a high bit of `$smc`. It overloads the
    flag the host repairs code on (`vm.raw('smc')` kinds 1/2 are read verbatim in dos-loop.js),
    and every `$smc` test would have to mask it. **Not chosen.** Price both against each other on
    fixed work, with V8 + SpiderMonkey native disassembly (`tools/wasm-native.js`), before
    deciding.
- **One extra dispatch per executed STI whose follower is not a transfer** (`jmp_ifen`, step
  refunded, so the clock is unchanged). One duplicated instruction when the follower was already
  a head.
- **No region over a loop that contains STI or POPF.**
- **`POPF` and `IRET` hand back once per pending event** (the first one that finds IF=1), only
  while a timer IRQ is pending.

## Tests

### Expected to pass on the candidate: `test-toyvm-irq-if-enable.js` (the 8db463eb source copy, which evaluates all three assertions on all five arms)

The five counted cases, each on l1/region/uop/uopOnly/fold. Each should have at least 7 deliveries
returning to X, none in a forbidden shadow, and the same (dispatch, ip) sequence as l1.

| case | why it should hold |
|---|---|
| `sti_nop` | `[sti][nop][jmp_ifen→X]`. jmp_ifen refuses with ifarm and `$gip = X`; exit `ifen`. |
| `sti_ret` | `[sti][ret]`. RET's CONT refuses on ifarm and RET_MISS's `$jlook_edge` refuses as well; exit `ret` with ifarm, `$gip = X`. |
| `sti_cli` | `[sti][cli][jmp_ifen]`: cli clears ifarm, so the jmp passes. `[nop][sti][nop][jmp_ifen→X]` then refuses. Nothing lands at f_cli, f_after_cli or f_nop2. |
| `popf` | popf after `delay` returns finds IF=1 and `irqpend`, and hands back mid-block (`$gip = X`; exit `popf`). |
| `iret` | the IRET's own check, `(irqwant\|irqpend) && IF`; exit `iret`, `$gip = X`. |

`sti_movss` remains **informational**. With `IFEN_STI_MOVSS = true` it is expected to report "composed
oracle held" (`[sti][mov ss][mov sp][jmp_ifen→X]`). It is not counted either way.

Arm notes for the fixture:

- **region:** hot regions are the `delay`/`spin` `loop` nests, which contain no IF ops. Pending is
  decided at stops, which are dates, so it is the same in every arm.
- **uopOnly:** the STI site is an `ifenShadow` fallback. `$ifarm` returns the drive to the session
  at the same handback as L1.
- **fold:** sti, popf and jmp_ifen are never folded.

### Existing toyvm tests most at risk, and why (from `ls test | grep toyvm`)

1. **test-toyvm-pm-timer-vector.js.** Protected-mode IDT timer, `sti` (line 130) and `iretd`
   (line 159). A timer due during the CLI'd setup now goes in after STI's follower instead of at
   the next stop, so the first tick moves earlier. It should still pass; it asserts tick arrival,
   not the date.
2. **test-toyvm-sb-single-cycle.js and test-toyvm-sb-highspeed-autoinit.js.** `sti` (88/198) and
   `iret` ISRs (79/190).
   - The SB boundaries are deliberately unchanged ($irqwant untouched).
   - The STI block layout changes (jmp_ifen), and the dispatch count is unchanged by construction.
   - At risk only if one of them also hooks INT 8/1C.
3. **test-toyvm-uop-only.js.** `pushf; popf` at 103/104. Not at risk unless a timer is pending:
   the STI fallback shape, the `mid` rule and the exitwhy reset are new code paths in drive.
4. **test-toyvm-region-live.js and test-toyvm-region-install-clock.js.** Regions containing
   STI/POPF now decline, and the walks stop at those ops. If either test's program has STI or
   POPF inside its region, the "region installed" or clock-equality assertions change. GO_RE was
   rewritten, so a regex mistake would silently stale-arena every unlowered transfer.
5. **test-toyvm-tree-fold.js.** Uses `iret` (973) in a fault-handler shape. Loop and call trees
   that would have contained popf or sti now decline. The bit-identical-to-l1 assertions are what
   to watch.
6. **test-toyvm-uop.js and test-toyvm-uop-live.js.** uop-harness NOT_GUEST/state lists, and the
   STATE growth in the comparisons.
7. **test-toyvm-retrace.js and test-toyvm-audio.js.** The schedule and dispatch clock: any change
   in where a pending timer lands changes later audio. They pass only if their programs never have
   a timer blocked by IF at a stop.
8. **test-toyvm-operand-patch.js, test-toyvm-volatile.js and test-toyvm-arena-recycle.js.**
   - The block layout around STI changes: a new block head at the boundary, and a follower
     duplicated into the STI block.
   - `jmp_ifen` has no `wordIp` entry. That is the intent, so repairProg does not decode it.
   - The volatile cut is suppressed inside a shadow.
9. **test-toyvm-browser-bundle.js and test-toyvm-live.js.** The handler table shifts by one and
   STATE grows. `docs/dos-corpus/live/toyvm-bundle.js` and `toyvm-jit-bundle.js` must be
   regenerated (`tools/toyvm/bundle-browser.js`). Until then the bundle-reproducibility build gate
   fails.

Corpus-level: BLIQ.EXE, BRW.EXE and CAVEIRA are the motivating programs. Their audio is expected
to CHANGE (that is the point). Arm parity is what must hold.

## Bounded runtime request (for later; not run)

One serialized slot of **at most 300 s total**, one process at a time. Everything goes under a new
directory `<new>` inside `scratch/claude-toyvm-brw-v2-review-20261005/if-enable/`:

    node if-enable/build-tree.js --out=<new>/cand --tree=stack
    patch -p1 -s -d <new>/cand < if-enable/impl-draft/candidate.diff
    TOYVM_TREE=<new>/cand TOYVM_TEST_TOTAL_S=140 node if-enable/test-toyvm-irq-if-enable.js > <new>/cand.txt
    # optional, same slot, only if time remains (each under its own `timeout`, <= 60 s):
    #   node test/test-toyvm-pm-timer-vector.js, test-toyvm-sb-single-cycle.js and
    #   test-toyvm-uop-only.js, run against <new>/cand.
    #   These tests are written for the repo tree; if they cannot be pointed at <new>/cand without
    #   an edit, skip them and say so.
    # then delete <new>/cand (about 3 MB); keep cand.txt

- **Pass criterion:** `all passed` for the five counted cases, plus `sti_movss` reported as `info`.
- **On failure,** record which assertion failed per arm: [1] at X, [2] in a shadow, or [3] parity.
- **A separate later slot** covers:
  - the corpus A/B (BLIQ/BRW/CAVEIRA, every arm, fixed dispatch budgets, wav and frame diffs);
  - the CONT performance gate (fixed work, user CPU, V8 + SpiderMonkey disassembly of a GO site
    before and after, and the `$smc`-high-bit alternative as the comparison arm).
