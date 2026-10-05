# Validating the folds that ship on by default

Six loop folds are enabled for every user with no flag:

```
sib_fusion   rect_run   case_chain   rle_run   smk_tree   pcx_run
```

Before 2026-09-19 none of them had ever been A/B'd against a real app. They
landed on perf numbers. `tools/block-exec-sweep.js` was already the right
harness — and already parameterized by `--flag` — but had only ever been
pointed at `--block-exec`.

## How to run it

The sweep's `on` arm just appends `--<FLAG>`, so a fold that is **on by
default** is tested by inverting the arms: make the deviation the `--no-` switch.

```sh
node tools/block-exec-sweep.js --apps=sol,caesar3_demo,quake2_demo \
  --no-build --control --flag=no-rect-run --budgets=150,300 --batch-size=20000
```

`off` is then the shipping default (fold enabled) and `on` is the reference
(fold disabled). Everything else about the tool is unchanged.

**Always pass `--control`.** It adds the off-arm-vs-itself run that turns "these
differ" into "these differ by more than this app disagrees with itself".

## Result, 2026-09-19

Ten apps — `sol notepad98 caesar3_demo quake2_demo diablo_shareware
starcraft_shareware heroes2_demo jazz2_demo pinball rct` — chosen so each fold's
own target app is present (`rle_run`→Caesar, `smk_tree`→Diablo,
`pcx_run`→Quake II). Budgets 150/300 at `--batch-size=20000`, `--control`.

| fold | verdict |
|---|---|
| `sib_fusion` | 10/10 IDENTICAL |
| `rect_run` | 10/10 IDENTICAL |
| `case_chain` | 10/10 IDENTICAL |
| `rle_run` | 10/10 IDENTICAL |
| `smk_tree` | 10/10 IDENTICAL |
| `pcx_run` | 9/10 IDENTICAL + 1 DIFFERENT (`quake2_demo`) — **resolved below, not a defect** |

**Run-to-run is now exactly 0.0000%**, because the sweep pins the guest calendar
(`--wall-clock-ms`, added the same day). That matters more than it sounds: it
means any nonzero number is a real behavioural difference and not noise, so a
row can be *investigated* instead of absorbed into a tolerance.

## The `pcx_run` / `quake2_demo` row, and the trap in it

`PCX_RUN` is Quake II's PCX/WAL decoder, so this is the single app/fold pair
where a miscompile would be most expected. It reproduced exactly across runs
(2.267% at budget 150 against a 0.398% band), which ruled out load noise.

Two wrong turns worth recording, because both are tempting:

1. **"It converges, so it's pacing."** It does shrink — 2.267% → 0.417% →
   0.284% — and there is even a good mechanism for it (`--batch-size` is a
   budget of *blocks*, a fold replaces many blocks with one, so the folded arm
   buys more guest work per budget and is simply further along). But at budget
   1200 it went back **up** to 0.401%, and the tool said `diverging`. An
   argument from convergence was the wrong test.
2. **"It diverges, so it's a defect."** Also wrong.

What it actually is: the changed box settles at `(63,21) 21x29`, immediately
left of the `GAME` menu item — the **blinking menu cursor**. An animation does
not converge, it oscillates, which is why neither the null band nor a
convergence check resolves it.

The measurement that settles it — localize the box, then ask whether that box
animates *within one arm*:

```
region (63,21) 21x29
  same arm, budget 600 vs 1200    48.4% differ   <- the region animates
  same arm, rerun at 1200          0.0% differ   <- runs are deterministic
  across arms at 1200             50.6% differ   <- same magnitude

  whole frame across arms:  308 px
  that region across arms:  308 px   <- equal, so NOTHING else differs
```

Every differing pixel in the frame is inside the cursor. Not one pixel of
PCX-decoded art differs, and the cross-arm phase difference is the same size as
the app's own budget-to-budget phase difference. `pcx_run` passes.

**General rule this gives the harness:** when a `DIFFERENT` row's changed box is
small and fixed, diff that box between two budgets of the *same* arm before
concluding anything. If it moves there too, the box is animating and the verdict
is pacing. This is a candidate for automating inside the sweep.

## What this does and does not establish

Establishes — five folds plus `pcx_run` change no pixels outside an animated
cursor, across ten apps including each fold's own target, at two budgets, with a
self-control arm and a pinned clock. That is the first evidence of any kind for
code that ships on by default.

Does **not** establish correctness:

- A PNG at batch 150/300 is an **early frame** — mostly boot and menus. A fold
  that miscompiles something only reached in deep gameplay is invisible here.
- Ten apps, not 201.
- A pixel comparison at a tolerance is weaker than a byte comparison.

The stronger instrument is a **deep end-state byte diff**: drive an app to a
real end state and compare the artifact it writes. See the save-route oracle in
[re-notes/starcraft-shareware.md](re-notes/starcraft-shareware.md) — three runs
produced one `ab.sng` hash, and it is what proved H466 correct. Its cost is that
each app needs a deterministic scripted route, which is why it is a tier to
build rather than a sweep to run.

## Prerequisite for anything new

The general diamond matcher that first motivated this page was **declined** by
its own census — see [diamond-loop-matcher-design.md](diamond-loop-matcher-design.md).
What survives is narrower: **SELFEXIT support**, loosening
`$loop_match_block`'s precondition so an existing fold reaches a loop whose
conditional exit splits its block (§22 of
[loop-idiom-superops-design.md](loop-idiom-superops-design.md)).

Narrower is not safer here, and the gate does not relax. A SELFEXIT fold has to
re-check the exit condition every iteration; getting that wrong does not shift
a cursor by a frame, it runs the wrong number of iterations and corrupts
memory — which a PNG at batch 150 is poorly placed to catch. So this page is
the floor, and the **byte-exact end-state oracle** (the StarCraft save route in
[re-notes/starcraft-shareware.md](re-notes/starcraft-shareware.md)) is the
instrument that actually fits the failure mode.
