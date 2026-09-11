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

### BLIQ, the one that remains

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
  reason each). See the run below.
