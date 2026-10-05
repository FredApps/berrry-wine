# Focused checks actually run (2026-10-05, main host, no guest loaded)

All of these ran on the main host. None of them ran `runDos`, `DosSession`, a `test-toyvm-*`
suite, a build, or a browser. Each took under a second except the bundle check, which took a few
seconds.

## 1. The patch against HEAD

```
$ git rev-parse HEAD
2683a6e31d0e95e7ffd1805fcafe013f94f1bcec
$ git diff --stat HEAD -- tools/toyvm/          # (empty: the shared toyvm tree is clean)
$ sha256sum dos-loop-irq-fix-v2.patch dos-loop-irq-fix.patch
4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78  dos-loop-irq-fix-v2.patch
8d6e3fd46a932abf74de71e5d9b8e741325417f69cbe477a221bf0112856a35a  dos-loop-irq-fix.patch
$ patch --dry-run -p1 < dos-loop-irq-fix-v2.patch          # from the repo root
checking file tools/toyvm/dos-loop.js
```

I built a patched copy from `git show HEAD:tools/toyvm/dos-loop.js` plus the patch. It is
`patched/dos-loop.js`, and HEAD's copy is `patched/dos-loop.base.js`:

```
bd4f1ee9eb1f19219918633544b7673ba94abc7e667b807ca0b2fa4e5a74e016  patched/dos-loop.js      (= the Phase 8b file)
ebe0eb30276b47fc7122dcd055e41c91f9a0c356a7e8e80b61fa8a3d43de8e21  patched/dos-loop.base.js
$ node --check patched/dos-loop.js
CHECK_OK
```

## 2. A pinned private tree loads, and step() carries v2 (`require-check.js`)

`tree-v2/` was built with `git archive HEAD` over the closure in corpus-plan.md, plus the patched
`dos-loop.js` and a `node_modules` symlink. The first attempt, with only `tools/toyvm` and the font,
failed with `Cannot find module '../disasm'` (run-dos.js:31). That is why the plan's closure also
lists `tools/disasm.js` and `tools/simd-ops.js`.

```
$ node require-check.js
dos-loop exports: DosSession,CodeCache,TICK_SECONDS,guestSeconds,dispatchesForGuestSeconds
run-dos exports has runDos: function
audio.wavBytes: function
present  Math.ceil(this.dispatched / grain) * grain || grain
present  at >= this.dispatched
present  this.dispatched > stopAt
present  left < 0 ? (atStop ? 'date' : 'budget')
present  this.dispatched - this.audioAt > sbInterval
```

## 3. The stopAt/ceil arithmetic and the review's scenarios (`schedule-model.js`)

This is a pure model of `step()`'s schedule arithmetic. Its first assertion greps every modelled
expression, verbatim, in HEAD's and v2's `dos-loop.js` and in `run-dos.js`, so the model cannot
drift from the source.

Edge cases:
- `d=0` gives `stopAt=25000`. `|| grain` is what saves it: `ceil(0)*g` is 0.
- `d=k*grain` gives `stopAt=d`, budget 1.
- `d=k*grain-1` gives `k*grain`, budget 1, the same as HEAD.
- Floating point is exact and stays in `[d, d+g)` for `d` up to 2^40.

The full output is in `schedule-model.out.txt`. The lines each finding rests on:

```
2. BRW 89.25M   head: ... atStop=true ... next stopAt 89275000
                v2:   ... atStop=false ... next stopAt 89250000 budget 1 -> d=89250003 clockAt 89250000   (= L1's 89250003)
3. cut==0       v2: cut at d=100000 atStop=true clockAt=100000; next stopAt 100000 budget 1 -> ... clockAt=100000   (S1 double stop)
4. VGA edge     v2: early at 89264448 atStop=false; vgaFrame->624 edge armed; delivered here=false; edge kept: false   (B2)
5. tick, grain 801 (pit-clock/GUS)   v2: early at 20350000 atStop=false; next stopAt 20350206 (T kept: false)          (B1)
   default grain 25000: T=550000 is a lattice point, kept
6. budget stop onto another date   v2: D TAKEN (extra budget-1 stop)   head: D skipped                              (N2)
7. one op in a budget-1 slice ends it past the date; only zero-dispatch handbacks repeat (as at HEAD)               (livelock)
8. endAt        v2: early at 8000000 atStop=false; run loop continues: false                                       (S2)
9. sbDueNow     strict sbDueNow is true at a non-stop handback only when the SB date was already overdue          (N4)
10. v3 delta    BRW unchanged (89250003/89250000); no double stop; T kept; VGA edge kept and armed at the stop; owesEnd runs one more slice
```

## 4. Every reader of stopAt / atStop / clockAt (patched copy, comments excluded)

```
1689 let stopAt = Math.ceil(this.dispatched / grain) * grain || grain;
1695 const due = (at) => { if (at >= this.dispatched && at < stopAt) stopAt = at; };
1721 ? Math.max(1, Math.min(this.slice, stopAt - this.dispatched))
1801 const atStop = !this.irqSchedule || this.dispatched > stopAt
1802   || (cut >= 0 && this.dispatched >= stopAt);
1814 const clockAt = atStop && this.irqSchedule ? stopAt : this.dispatched;
1821 const frame = Math.floor(clockAt / this.vgaPeriod);          <- runs on EVERY handback (B2)
1860 : left < 0 ? (atStop ? 'date' : 'budget')
1931 if (atStop) machine.setClock(clockAt / this.dispatchesPerTick * this.tickScale);
1976 ? (atStop || sbDueNow)
1980 const spent = this.irqSchedule ? clockAt - this.audioAt
1982 this.audioAt = this.irqSchedule ? clockAt : this.dispatched;
1986 if (atStop) {                                                 (mouse)
2039 && (machine.sbForced() || (atStop && (machine.sbDue ? machine.sbDue() : true)
2040   && clockAt - this.lastSbIrq >= this.irqEvery))
2046 const gvec = atStop && ...      2047 const tvec = atStop ? machine.timerVector() : 0;
2056 const rvec = atStop && this.retraceEdge && ...   2058 if (atStop && this.retraceEdge && ...)
2062 this.lastSbIrq = clockAt;     2064 } else if (tvec && clockAt - this.lastIrq >= ...)
2075 ? this.lastIrq + Math.floor((clockAt - this.lastIrq) / ti) * ti
2088 } else if (atStop && clockAt - this.lastKbIrq >= this.kbInterval()   2091 this.lastKbIrq = clockAt
```

Outside `dos-loop.js`, `grep -rn 'stopAt|atStop|clockAt|grain' tools/toyvm/*.js` finds no other
schedule reader. The `stopAt` names in run-dos.js:818/850 (wall deadline) and uop-ref.js are
unrelated. Of the other run-loop terminators, only `run-dos.js:825` and `dos-loop.js:2165` loop on
`dispatched < budget`, which is S2.

`exitKinds` consumers: run-dos.js (`--handback-kinds` print) and the sweep-dos.js row. No
`test/test-toyvm-*.js` and not sweep-diff.js. So N1 is report-only.

## 5. Budget-test semantics on every exit path (source read)

- emit.js:623, 731, 783: `i32.lt_s $steps 0`.
- Spin folds keep the `< 0` exit exact: emit.js:2232-2259 and 3520-3561.
- The µop engine uses `due = steps < 0` and `check = steps < I` (uop-wasm.js:458, 470).
- uop-only hands back on `left <= 0` (uop-only.js:262).
- HLT is `H.end`, an early handback (decode.js:632).
- `Machine.endSlice` sets `steps = -1` and saves `sliceCut` (dos.js:2799-2814).

Invariant I1 holds on every budget path.

## 6. Build-gate exposure (B3)

```
$ grep -c "Math.floor(this.dispatched / grain) * grain + grain" docs/dos-corpus/live/toyvm-bundle.js docs/dos-corpus/live/toyvm-jit-bundle.js
docs/dos-corpus/live/toyvm-jit-bundle.js:1
docs/dos-corpus/live/toyvm-bundle.js:1
$ node tools/toyvm/bundle-browser.js --check       # baseline, shared tree at HEAD
docs/dos-corpus/live/toyvm-bundle.js: up to date (2166KB)
docs/dos-corpus/live/toyvm-jit-bundle.js: up to date (2138KB)
```

`tools/build.sh:155` runs that check, so a commit carrying the patch without regenerated bundles
fails the build.

## 7. Corpus inputs (`unpack-corpus.js --dry-run`)

```
199 programs in 146 directories; 684 files, 70.4 MiB; 199 .exe/.com files a --dir walk would find
corpus content sha256 3f9b202376eec52a72f9c1c0eb9f0dfd993292c344d62b95a820a9e5606fc475
sha256 1995-c-cma_brw/BRW.EXE 65b61f6c3ec838431bc7bf146f0a75b37151af8e57b0b589fc9187c960ddfeb4   (= longrun-bg fixture)
```

`/tmp/demos` does not exist on this host, which is why the plan unpacks the corpus from the
committed bundles. `programs-199.txt` is the list. It contains two `BLIQ.EXE` (1994-b-black and
1994-b-bliq), which is why the plan's own driver keys rows by path.

## 8. The plan's scripts (syntax and plumbing only)

```
$ node --check corpus-ab.js && node --check unpack-corpus.js && node --check schedule-model.js   -> SYNTAX_OK
$ bash -n corpus-plan.sh                                                                         -> OK
$ node --check corpus-plan.js   (JavaScript port, replaces corpus-plan.sh)                       -> OK
$ node corpus-plan.js           (no W)        -> "set W to an empty work dir", exit 2
$ W=<tmp> node corpus-plan.js bogus           -> usage line, exit 2
$ node --check patched/dos-loop.v3.js && node --check patched/run-dos.v3.js                      -> V3_SYNTAX_OK
$ patch --dry-run -p1 -d tree-v2 < v3-delta-on-v2.patch
checking file tools/toyvm/dos-loop.js
checking file tools/toyvm/run-dos.js
```

- `corpus-ab.js --compare` / `--moved` / `--nudge` on synthetic rows (`selftest/`): these correctly
  report BROKE, fixed, moved, WENT BLANK and the nudge classes, with duplicate basenames kept apart.
- The runner's awk test gate and sweep-diff name extraction were exercised on synthetic text.

## Not run (needs the runtime slot; see corpus-plan.md)

The 28 toyvm suites, every corpus sweep, BRW 500M, and any run of the v3 delta on a guest.
