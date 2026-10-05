# Censusing a long load: how to find out whether an app has a hot loop at all

2026-09-14. Method note plus the measurement that motivated it. The subject is
Warcraft III's campaign map load — a load long enough that it had been profiled
several times from a single window, each time producing a different answer.

**Verdict up front: the Warcraft III map load has no hot loop.** Across eleven
45-second windows spanning eleven minutes of the load, **no code region holds
5% or more of block entries in every window**, so there is nothing there that a
superinstruction could fold. `ijl15.dll` (the JPEG decoder) is not a hot loop
either — it is a *phase*, swinging between roughly 0% and 72% window to window
and alternating with `Game.dll` the way a decode-then-consume pipeline does.
Weighted across the whole series it is 29.4%, not the ~40% a single early
window had suggested, which caps an `ijlRead` interception at about **1.4x** of
this load rather than 1.7x — and only if the interception were free.

§1–§3 are the method and are not specific to this app. §4–§6 are the data.

---

## 1. Why one window lies

A profiling window is a sample of a *scene*, and a long load is a sequence of
scenes. Nothing about a single window announces which one you got.

This has already cost this project twice:

- **SimGolf.** `jgl+0x10017b6f` measured 9.65% of block entries in one sample
  and was absent from the top forty in the next. A superinstruction (H455) was
  built for it. It moved the frame rate not at all. That is why
  `tools/hot-loop-census.js` exists, and why its closing section reports only
  regions hot in *every* window.
- **Warcraft III, this file's subject.** An early window put `ijl15` near 40%,
  and that number went into the re-notes and into the argument for intercepting
  the JPEG decoder. §5 shows what eleven windows say instead.

The census tool then demonstrated the failure live, on the very data collected
for this note. Read window 1 **alone** and it nominates
`Game.dll+0x6f4a4220..6f4a42f0` (13 blocks) as a fold target at **19.9%**.
Across the full series that region is **0.0% in all ten other windows**.

> **The rule:** a region's *spread* across windows is the finding, not its
> mean. A region at 53% in one window and 0% in another is a scene. Only the
> "hot in EVERY window" list is worth building against.

## 2. What was missing: nothing produced the windows

The census consumes several windows; the ctl probe is a single shot. For a CLI
session nothing sat between them, so every long-run conclusion came from one or
two hand-timed samples. `tools/ctl-hist-series.js` fills that gap — it arms,
waits, reads and re-arms against a live `--control` session, writing one window
per line of NDJSON.

Since `4c819b18` `tools/hot-loop-census.js` reads that series file directly, so
the pipeline is two commands rather than a converter script each time.

Two properties make a series trustworthy on a shared machine:

- **Arming resets the counters,** so windows do not overlap and the gap between
  them is genuinely unsampled. `--gap=0` measures everything at the cost of
  never letting the histogram be off.
- **Shares of block entries are load-immune.** This box regularly sits at load
  20–40 with several agents sweeping, and a wall-clock rate measured there
  describes the machine. A share does not, which is why the series tool
  deliberately prints no rates at all.

## 3. Prerequisites the method needs, both learned the hard way

### 3.1 Drive the GUI from `--input`, paced in BATCHES

To census a load you must first *reach* it, which for a game means clicking
through its menus headlessly. Two traps, both of which cost real time here:

- **Check what the app actually reads before choosing an input mechanism.**
  Warcraft III's menu was assumed to need DirectInput. Tracing every cursor and
  DirectInput entry point over a 75-second load: **201 `ClipCursor`, 198
  `GetCursorPos`, and zero DirectInput device calls.** It is absolute cursor
  position plus window messages, so driving it through
  `_queueDirectInputMouseButton` moved nothing — nothing was listening.
- **Pace by batch, not by wall clock.** The second half of that failure was
  sending a press and scheduling its release with a 1.5s `setTimeout`. The
  guest samples the button per *batch*, and batch rate swings enormously with
  phase — measured between 362/s in a healthy load and over 4,000/s while
  spinning behind a modal. A wall-clock release straddles the sample.
  `--input=BATCH:...` is paced in the guest's own unit.

Take a `B:png:PATH` snapshot between steps. A mis-aimed click is then visible
rather than silent, and the hover highlight confirms `GetCursorPos` is reading
your position before you trust the click.

### 3.2 `--headless-gl` needs an awake display

For any OpenGL guest, the census is worthless if GL never came up — and the
failure does not look like a GL failure. Measured:

```
[gl] context creation FAILED (800x600, 0 already live):
     No suitable display found for a new GLFW Window.
```

`glfw.init()` returns **true** while `getMonitors()` returns `[]` and
`getPrimaryMonitor()` is `null`. On macOS the display list empties when the
screen sleeps, so a run that started after the Mac idled fails with nothing
wrong anywhere near the cause: `wglCreateContext` returns 0, the guest takes
its no-3D-hardware path, and the first visible symptom is an app-level "unable
to initialize DirectX" message box a hundred log lines later — at several times
the normal batch rate, because a guest spinning behind a modal retires tiny
blocks. That reads convincingly as a flaky emulator. It is a slept screen.

```bash
caffeinate -d node test/run.js ... --headless-gl
```

`caffeinate -d` holds the *display* awake; plain `caffeinate` blocks only
system sleep. Since `5aee326d` the startup line reports the display count, and
refuses up front when there are none, so this is now one line rather than a
puzzle.

## 4. The workflow

```bash
caffeinate -d node test/run.js --app=warcraft3_demo --no-threads --headless-gl \
  --quiet-api --control=8124 --input="<the menu walk>" \
  --max-seconds=1500 --max-batches=99999999 --no-close > /tmp/wc3.log 2>&1 &

# once the input walk has landed and the load has actually started:
node tools/ctl-hist-series.js --port=8124 --log=/tmp/wc3.log \
  --window=45 --gap=15 --count=11 --out=/tmp/wc3-series.ndjson

node tools/hot-loop-census.js /tmp/wc3-series.ndjson --top=14
```

`--log=` is not optional in practice: it is where the `DLL: NAME at 0xBASE,
..., origBase=0xORIG` lines come from, and without them every block attributes
to `exe`.

Check three things before believing the output — the startup line's display
count, the absence of `[MessageBox]` in the log, and that the walk's `[input]`
lines actually landed.

## 5. The data

Eleven windows of 45s with 15s gaps, Warcraft III campaign map load:

```
  window  ops/blk distinct    ijl15     Game    Storm   msvcrt
   t+45s    10.29    26970      6.5     25.7     25.0        -
  t+105s     7.31     9152     72.3        -        -        -
  t+165s     6.90     8741        -     32.3      5.0        -
  t+226s     6.27    15521      2.0     12.0     12.7      6.7
  t+286s     6.51    15390     47.8      7.5        -        -
  t+346s     6.10    11064     27.0      4.9      7.0      5.9
  t+406s     5.13    10433      0.3     26.8     12.4      9.7
  t+466s     4.87     6516        -     24.4     14.6      9.7
  t+526s     6.39    10654     41.5      5.0      3.9      1.8
  t+586s     4.91     9148        -     20.6     16.5      9.9
  t+647s     7.32    17483     35.0        -      8.6      3.6

11 windows   2.9G ops   405M block entries   7.10 ops/block overall
weighted:    ijl15 29.41%   Game 14.31%   Storm 7.97%   msvcrt 2.34%
```

The top regions by mean share, with their spreads:

```
  region                                mean  spread
  Game.dll+0x6f0deb60..6f0deb65         5.9%  19.2pp
  Storm.dll+0x15033ce0..15033d02        4.9%  14.3pp
  ijl15.dll+0x60029ba0..60029c9b        4.6%  13.6pp
  ijl15.dll+0x60027883..60027930        4.1%  12.6pp
  ijl15.dll+0x60027c00..60027d3b        3.6%  16.0pp
```

```
NO region holds >=5% of block entries in every window.
Nothing here is a safe fold target on this evidence.
```

## 6. Reading it

**`ijl15` is a phase, not a loop.** Its per-window share runs
`6.5, 72.3, ~0, 2.0, 47.8, 27.0, 0.3, ~0, 41.5, ~0, 35.0`, alternating with
`Game.dll`: decode a JPEG, consume it, decode the next. Its weighted 29.41% is
still the largest single lever in this load, and intercepting `ijlRead`
(`ijl15.dll` orig `0x600333d0`) remains the one worthwhile idea — but by
Amdahl it caps the whole load at ~1.4x, and that is the ceiling for a *free*
interception.

**No loop is worth folding.** The largest mean share of any region is 5.9%, two
blocks wide, and it is 0.0% in six of eleven windows. Every region with a large
number carries a matching large spread.

## 7. What these numbers do NOT say

Shares of block entries are load-immune and comparable window to window, which
is exactly why they are the unit here. They are **not time.**

`ops/block` falls steadily across the series, 10.29 → 4.87. Later windows
retire cheaper blocks, so a share of block *entries* is not a share of wall
clock, and none of the percentages above converts to a speedup. A block is not
a fixed amount of work: measured elsewhere, one app spans 6.9 to 282 ops per
block between two of its own scenes.

To turn any of this into a time claim you need fixed work and wall time, or
user CPU under known load — not a share.

## 8. What to build instead

1. **Nothing block-local.** The census says there is no fold target; a
   superinstruction aimed at any region here would repeat the SimGolf H455
   result.
2. **The `ijlRead` interception, with its real ceiling written down.** ~29% of
   block entries, ~1.4x cap, and it must beat the guest decoder by enough to be
   worth the ABI surface.
3. **Re-census before building.** These shares belong to one machine, one
   build and one load. The workflow in §4 is two commands; run it again rather
   than quoting this table.
