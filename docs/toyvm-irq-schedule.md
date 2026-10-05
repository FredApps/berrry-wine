# The interrupt schedule

A fold that changes how often the guest hands back must not change what the
guest hears. Before this, it did.

## The mechanism

The run loop drives the guest in slices: compile a region, run it, notice why it
stopped, service what it asked for, and *then* — between slices, where `cs:gip`
is a real instruction boundary — push any interrupt that has come due in front
of the next instruction. Everything the host owes the guest was quoted as a
RATE in dispatches (a timer tick every `timerInterval()`, a retrace every VGA
frame period, a Sound Blaster block when its last sample goes through the DMA
channel) and delivered **at the first handback after the rate was met**.

How far after is not a property of the guest. It is a property of the code
cache. A self-loop whose back edge the compiler could not resolve hands back
once per iteration; fold that loop and it does not. So:

> **Absorbing a handback moves every later interrupt injection**, even though
> the guest computes exactly the same thing, at exactly the same dispatch count,
> in exactly the same guest seconds.

`--lattice-clock` could not reach this. It anchors where audio is *rendered*; it
cannot anchor where an interrupt is *delivered*, because the host can only
inject one between slices.

### The trace

`--trace-irq` prints one line per injected vector with the three numbers that
separate the emulated clock from the host's grid: the dispatch count (`at=`),
the handback index (`hb=`), the guest seconds the clock derives (`t=`), and the
guest address the frame went in front of.

```
node tools/toyvm/run-dos.js /tmp/demos/1994-d-dawn/DADEMO3.EXE \
  --dispatches=80m --pit-clock --auto-key --sound-pref=sb \
  --env=ULTRASND=220,1,1,11,7 --trace-irq
```

DADEMO3 at 80M, plain against `--tree-fold --tree-fold-hot=64`, on the old
schedule (`--no-irq-schedule` reproduces it exactly today):

| | plain | `--tree-fold` |
|---|---|---|
| frame | 36128ac7 | 36128ac7 |
| dispatches | 80,035,358 | 80,035,358 |
| guest seconds | 7.99 | 7.99 |
| interrupts / host vectors | 177 / 645 | 177 / 645 |
| handbacks | 46,340 | 28,209 |
| wav | 84b95c3f | **442a46e9** |

and the injection lines around the first divergence — line 36 of 645:

```
plain   irq vec=08 timer at=10294368 hb=2077 t=1.028041 from 8:b2e9
fold    irq vec=08 timer at=10294368 hb=2077 t=1.028041 from 8:b2e9
plain   irq vec=08 timer at=10412089 hb=2153 t=1.039797 from 8:b2e9
fold    irq vec=08 timer at=10412065 hb=2129 t=1.039794 from 8:b2e9   <-- 24 dispatches apart
```

**610 of the 645 injections land at a different dispatch count**, while the
frame, the dispatch total and the guest seconds are identical. DADEMO3's timer
ISR is what drives its Ultrasound playback — `out_8` is its single hottest
handler at 16.4% of all dispatches — so its register writes are stamped a few
hundred steps from where they were and the wav moves. That is the whole bug.

## The fix

Stop quoting the host's obligations as rates and start quoting them as **dates**
— absolute dispatch counts — then cut the slice to land on the next one. It is
in `tools/toyvm/dos-loop.js` `DosSession.step`, on by default, with
`--no-irq-schedule` as the A/B partner.

1. **A stop is a date.** Before each slice, the loop takes the minimum of the
   dates it owes: the render lattice (a fixed grain, `shortest / 4`), the next
   timer tick (`lastIrq + timerInterval()`), the next keyboard slot, the next
   VGA frame edge, the running Sound Blaster block's last sample, and the next
   BIOS tick-word boundary. The slice's budget is the distance to that date,
   capped by `--slice`.

2. **Only a handback that reached its date may do the clock's work.** A
   handback the guest caused on the way past — an unresolved jump, a store into
   compiled code, a port write — is billed and counted and then the next slice
   is cut to the *same* date, so the two arms meet there whatever either did in
   between. Interrupt delivery, the audio render, the PIT phase and the mouse
   rate are all gated on that.

3. **The clock reads the date, not the odometer.** A slice cut to a date still
   overshoots it: a block only tests its budget at its transfer. Measured on
   DADEMO3, the interpreter and the folded loop overshot the same date by
   different amounts — by *one single op*. Marking the event at `dispatched`
   writes that op into the next date and the one after until the arms are
   delivering to different instructions; marking it at the date leaves the
   overshoot billed to the window it actually ran in, which is the next one.
   This is what took DADEMO3 from "the same schedule ±2" to "the same schedule".

4. **Overdue is not negative.** An earlier attempt at a due-date budget (see the
   quantum comment in `step`) collapsed because it read a date as "time until
   the next event" for events that are conditional: an interrupt nobody hooked
   never advances its mark, the remaining time goes negative, and every later
   slice pins at the one-step floor. `due()` only takes dates in the *future*,
   so an overdue conditional event stops constraining the slice and is retried
   at the next stop — which is what a real line held off by a cleared IF does.

The one rung not gated on a stop is a Sound Blaster line **armed by a port
write**: that instant is the guest's own store, `Machine.endSlice` already cuts
the slice at it to give the interrupt a card's latency rather than a slice's,
and it is at the same dispatch count in every arm because the guest put it
there.

`--lattice-clock` is superseded and now does something only alongside
`--no-irq-schedule`.

## The witnesses

`--dispatches=80m --pit-clock --auto-key --sound-pref=sb
--env=ULTRASND=220,1,1,11,7 --audio=FILE`, three arms of one build: plain,
`--tree-fold --tree-fold-hot=64`, `--region-jit`.

### Before (`--no-irq-schedule`)

| witness | frame | wav plain | wav fold |
|---|---|---|---|
| DADEMO3 | 36128ac7 | 84b95c3f | **442a46e9** |
| RUNDEMO | 08502c5c | 9d93bd2a | 9d93bd2a |
| BLIQ | a12d718a | e1c772ec | **9e6bdfeb** |
| ACME-BIG | 362275f5 | a867dd80 | a867dd80 |
| CONTAGIO | 163af616 | f3424ccf | **efc8d3ac** |
| CATWALK | 19cfa368 | 9268efa3 | **e31ee7e1** |

Four of six wavs moved with the fold.

### After

| witness | frame (all arms) | wav plain | wav fold | wav region-jit |
|---|---|---|---|---|
| DADEMO3 | 36128ac7 | c97d1d54 | **c97d1d54** | **c97d1d54** |
| RUNDEMO | fcf5e9b5 | 343d83b3 | **343d83b3** | **343d83b3** |
| BLIQ | dbb3c55d | 129b48df | 383ec794 | **129b48df** |
| ACME-BIG | 362275f5 | 74bdd7df | **74bdd7df** | **74bdd7df** |
| CONTAGIO | 163af616 | 331a6704 | **331a6704** | **331a6704** |
| CATWALK | 19cfa368 | 6035ae47 | **6035ae47** | **6035ae47** |

**Five of six are now identical in all three arms**, frame and wav, including
DADEMO3 — the witness the tree-fold doc named as the one neither
`--no-tree-fold-loops` nor `--lattice-clock` could answer. The install schedule
no longer reaches the audio either: `--tree-fold-batch=1`, which used to
reproduce the *moved* value, now gives the plain wav byte for byte on DADEMO3
(c97d1d54), CATWALK (6035ae47) and CONTAGIO (331a6704).

### BLIQ, the one that remained — and what it actually was

**Resolved.** The paragraph below is the state of the investigation as it stood
and is kept because its measurements are right; the conclusion it reaches
("a billing question in `tree-fold.js` / `region-jit.js`") is not. See *A
handback is not a dispatch* below for the cause and the fix, and *The witnesses,
after the handback fix* for the numbers that replace the table above.



BLIQ's fold arm still diverges, and it is not the injection grid: its
`ints` count differs too (2979 against 2984), which is guest divergence and not
re-timing. It also diverges with `--no-tree-fold-loops`, so it is not the loop
fold; and it gives a third wav at `--tree-fold-batch=1`, so it is install
schedule — the class the tree-fold doc had already recorded for it ("BLIQ and
CONTAGIO were already install-schedule movers before any of this work").

The mechanism, from `--slice-log --slice-log-regs` on the two arms: they agree
exactly to dispatch 10,013,362, then hand back at the same address `8b5:73` with
*different registers* — different iterations of one tight loop — and re-converge
at 10,013,573 with identical registers. That is the residual overshoot: the two
arms exit the same date at different block transfers, a couple of ops apart, and
a couple of ops is a whole iteration of that loop. Closing it means making the
fold's billed step count agree with the interpreter's op-for-op at the exit
edge, which is a billing question in `tree-fold.js` / `region-jit.js` and not a
scheduling one. Total dispatches are identical (80,035,358 both arms), so the
disagreement is local to the edge, not cumulative.

## A handback is not a dispatch

The residual was not in the fold at all. It was in `$next`.

`$next` charged its step and *then* tested `$halt`:

```wat
(global.set $steps (i32.sub (global.get $steps) (i32.const 1)))
(if (global.get $halt) (then (return)))
```

A handback does not end the wasm call. The handler that takes one calls
`$slice_exit`, which sets `$halt`, and then tail-calls `$next` like every other
handler; `$next` notices and returns. With the decrement in front of the test,
that trip through dispatch — which runs **no guest instruction**, it only
discovers that the slice is over — was billed to the emulated clock.

So the clock counted handbacks. And **handbacks are a property of the code
cache, not of the guest**: one guest transfer costs one dispatch when the edge
is linked and two when it is not, the phantom plus the target's first op after
the host re-enters through `run()`. Anything that changes which edges are linked
moves the clock without changing a single guest instruction — and a tree-fold
install does exactly that, because `dropWanting` drops the programs holding a
wanting block and recompiles their heads, which drops their traced edges.

BLIQ.EXE is the witness that could see it because it reprograms PIT channel 0
and reads the count back, so a clock a couple of hundred phantom steps out ran
its timer at a different rate from there on — a different interrupt *count*
(2979 against 2984), which is why it read as guest divergence rather than
re-timing.

The fix is to test `$halt` first, in all four dispatch shells
(`HALT_FIRST` in `emit.js`). An unlinked transfer then bills exactly what the
linked one does.

### The evidence that it was not the trees

Three measurements, each of which rules out a body-level explanation:

- With `--no-tree-fold-loops`, only `--tree-fold-relax=partial` diverged;
  `none`, `flags`, `string`, `rep`, `shifts` and `muldiv` were byte-identical to
  plain over 14M dispatches (`shared=14046 differing=0`).
- Restricting the lowering to any ONE of the four partial-only trees reproduced
  the *identical* divergence — **including for trees that made zero
  substitutions**. A fold that changes nothing in the arena cannot change what
  the guest computes, so the cause was the extra *candidate* changing the
  install's drop set.
- In the window after the first install, both arms stood at dispatch 10,013,362
  with identical registers. Plain then ran three slices — `8b5:73` (13
  dispatches), `8b5:95` (3), `8b5:1e4` (19), 35 in total — to reach the register
  state the fold arm reached in ONE 33-dispatch slice from `8b5:73`. Same guest
  work, 32 real ops; two fewer handbacks, two fewer dispatches. One phantom
  step per handback, exactly.

`--no-fuse`, `--no-trace-blocks`, `--no-spin` and `--no-rep-fast` all left the
divergence unchanged, which is what said the difference was not in any compile
transform that changes the op stream.

### The regression test

`test/test-toyvm-tree-fold.js`, section *A handback is not a dispatch*. It takes
the fold out of it, because the fold is not what the mechanism is about: the
knob is **the slice length**. The same program is run at a 2M slice and a 20k
slice and must bill the same number of dispatches, with a control assertion that
the two arms really did hand back a different number of times (measured: 71
against 103 handbacks, 900,404 dispatches both). With the phantom step back in,
the tight arm bills 32 more.

## The witnesses, after the handback fix

Same recipe, three arms of one build (plain, `--tree-fold --tree-fold-hot=64`,
`--region-jit`). The wav hash is FNV-1a over the wav bytes, the same function
`frameHash` uses.

| witness | frame (all arms) | wav plain | wav fold | wav region-jit |
|---|---|---|---|---|
| DADEMO3 | 36128ac7 | 55358cf2 | **55358cf2** | **55358cf2** |
| RUNDEMO | fcf5e9b5 | 9b51195e | **9b51195e** | **9b51195e** |
| BLIQ | 3243b8e3 | e2a1b6b5 | **e2a1b6b5** | **e2a1b6b5** |
| ACME-BIG | 362275f5 | 27904a23 | **27904a23** | **27904a23** |
| CONTAGIO | 163af616 | bb5cf796 | **bb5cf796** | **bb5cf796** |
| CATWALK | 19cfa368 | 1031f0ce | **1031f0ce** | **1031f0ce** |

**All six are identical in all three arms**, frame and wav. Five frames are
unchanged from the table above; BLIQ's moved (dbb3c55d → 3243b8e3) because its
clock was the one the phantom steps were actually distorting, and it is the arm
whose timer now runs at the rate the guest programmed.

Removing a step per handback shifts every wav in the table, for the same reason
the schedule work shifted them: these are the correct values and the old ones
were the phantom-quantized ones.

## The baselines changed, and here is the ground truth

**Every plain wav in the table moved, and two frames moved with it** (RUNDEMO
08502c5c → fcf5e9b5, BLIQ a12d718a → dbb3c55d). That is not incidental damage;
it is the fix, and the old numbers were the handback-quantized ones.

Under the old rule the timer's mark advanced to *where the handback landed*, so
every tick's lateness was added to the next tick's due date and the guest's
timer ran slow by however often the loop happened to hand back. On DADEMO3 the
injections were 117,721 dispatches apart against a programmed interval of
100,098 — **the demo asked for a 100 Hz music timer and got 85 Hz**. Under the
schedule the spacing is exactly 100,098.

DOSBox-X is the second implementation, and it agrees with the new number:

```
node tools/toyvm/dosbox-ref.js --exe=/tmp/demos/1994-d-dawn/DADEMO3.EXE \
  --gus --seconds=25 --out=ref.wav
node tools/toyvm/audio-check.js ours.wav ref.wav
```

| render | beat period | vs DOSBox-X | pitch | chroma similarity at scale 1.00 |
|---|---|---|---|---|
| DOSBox-X (GUS) | 1598.8 ms | — | — | — |
| ours, before | 1820.3 ms | **13.9% slow** | 0 cents | 0.841 |
| ours, after | 1595.0 ms | **0.24% fast** | 0 cents | 0.852 |

Same tuning either way — no value the guest computes changed — and the tempo
goes from 14% flat to within a quarter of a percent of the reference. The moved
baselines are the correct ones.

`--no-irq-schedule` reproduces every pre-change hash exactly, which is how an
older recording is read back.

### What the plain baselines are now stable against

The point of a schedule is that a host-side knob cannot move what the guest
hears. On DADEMO3 and CATWALK, plain, at 80M:

| knob | before | after |
|---|---|---|
| `--tree-fold-batch=1` vs the default batch | moved | **same as plain** |
| `--region-jit` install | moved | **same as plain** |
| `--tree-fold` (handbacks 46,340 → 31,960) | moved | **same as plain** |
| `--slice=2000000 / 500000 / 50000` | same | **same** |

The one remaining sensitivity is a `--slice` set *below* the event grain
(`shortest / 4`, tens of thousands of dispatches): there the slice cap itself
becomes the finest stop and the audio is re-quantized. The render lattice is
quoted off the events rather than off `this.slice` precisely so that every
ordinary setting — the 2e6 default and the sweep's 20000 — lands on the same
grid; `--slice=5000` does not, and that is a debugging configuration.

## Cost

The schedule adds stops, so it adds handbacks: DADEMO3 46,340 → 50,237 plain
(+8%), CATWALK 29,548 → 30,966 (+5%), ACME-BIG 17,704 → 18,607 (+5%). No timing
is quoted here; the counts are what the gate reads.

## Gates

- All 23 `test/test-toyvm-*.js` suites green.
- Six witnesses at 80M in three arms, above.
- Corpus, `sweep-dos.js --dispatches=8m --reps=1` before (`--no-irq-schedule`)
  against after, through `sweep-diff.js`. A clock retiming is *supposed* to move
  the frame hash of a time-paced program, which is why `sweep-diff.js` separates
  `regression` and `went blank` (blocking) from `changed` (expected, one line of
  reason each). See below.

### The corpus run

199 programs in each sweep, 191 names in both.

```
REGRESSIONS: run status got worse (block the change): 0
WENT BLANK: drew pixels before, none now (explain or block): 0
recovered: 2   QUARTZ.EXE timeout -> ok;  do.exe arms-disagree -> ok
bucket moved: 1   QUARTZ.EXE blank -> demo (drew more; px 0 -> 468)
```

Nothing blocking. Two programs got *better*: QUARTZ.EXE used to hit the sweep's
own timeout and now finishes and draws, and `do.exe` used to disagree between
its four interpreter shells and now agrees — a program whose shells disagree is
a program whose result depends on how often it hands back, which is the bug this
change removes.

**Dispatches moved on 184 of 191, and they all moved the same way.** The before
arm overran its 8,000,000-dispatch budget by up to 42,888 (NT_DEM1.EXE; ~10k
typical); the after arm lands within 36 of it, usually within 4. That is not the
guest doing different work, it is the last slice no longer being allowed to run
past the end of the run: a stop is a date now, so the budget is one of the dates.
It also means the two sweeps are not sampling the same instant, which matters for
the next paragraph.

**Frame hashes moved on 22 of 191 rows** (20 distinct binaries; `ZERO-BBS.EXE`
appears three times from three directories). Every one of them is still drawing.
`phase.js` in the scratch tree re-ran each of them in both arms at 8.00M, 8.01M,
8.02M and 8.04M dispatches — a ≤0.5% nudge, smaller than the overshoot the before
arm was taking for free — and the 22 split three ways:

| what the nudge showed | rows |
|---|---|
| a frame the before arm draws reappears in the after arm | 11 |
| the hash is not stable within *one* arm across the nudge, so it was never an identity | 7 |
| stable in both arms and still different | 4 |

Of the last four, BKSNOTE.EXE is located exactly: `after@8.00M == before@8.20M`,
so the after arm is 2.5% further into the same animation on fewer dispatches —
which is the timer-rate correction from the section above, seen in a picture
instead of a wav. brainbug.exe draws the *same* frame in the before arm from
8.0M to 10.0M and a different one with 68,128 pixels against 36,840 in the after
arm: it drew more, not less. BMGLP.EXE (1,112 → 4,837 px) and ALCHYMIA.EXE
(2,579 → 2,550 px) were not located on a 0.1M-step walk of the before arm; both
keep drawing and neither lost its picture.

So: no program lost pixels, two gained a working run, and every frame that moved
belongs to a program whose picture is a sample of a time-paced animation. The
frames of programs that are *not* time-paced — the 169 other rows — did not move.
