# P versus P+C in real games

2026-10-01. Follow-up to [the P/C/D matrix](fp-combinations.md). P predecodes the FP semantic selector; C counts remaining island records down to zero. This compares the same two frozen modules, not a production change.

Subsequent [MW3 repeatability investigation](fp-mw3-repeatability.md): sharing
the pinned calendar with the cooperative loading thread removes the observed
counter drift. Six longer cockpit runs then pass the work gate; the balanced
PC/P/P/PC comparison uses **1.588% more CPU for PC**, reversing this report's
provisional one-pair gain. Keep the original observations below as historical
evidence, not the current MW3 verdict.

## Method

Dedicated ASCII box `bx_4r5uzdwv`, restored this time onto an AMD EPYC-Rome KVM host, four vCPUs. Node24.18.1 / V8 13.6.233.17-node.50. Absolute times cannot be compared with the preceding Ryzen results. Runs are serial and use frozen revision `837f0a74` host code. Runner, host and app-registry hashes were verified against the local frozen checkout before launch.

- P: `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b`
- PC: `8e503d1e1588ca5292af82d63e56ba07eb6dca5d6c0803f161459b96fc8fb4d9`
- `test/run.js`: `95f900c842bb21329555cbd9a55643541a4e2f1a9720780a643f3277a997afcb`
- `host.js`: `9d27e414ea00eccdbd7e8bc80c9c15163b2558fa229f08f9dd4ca76e6ea5e66a`
- `lib/apps.js`: `3df316ca7c8acb1903996b6df7733df32a27a01783e46ed240546fbac447f900`

`tools/uop-game-ab.js` uses branch-clock, fixed calendar, the uop tier, x87 fusion and cooperative guest scheduling. The primary metric is process user CPU including all cooperative guest threads. These headless routes use software rendering; they do not measure browser WebGL FPS. Each game's existing input route is retained. MW3 extends from 1,150 to 1,750 batches, providing 600 additional cockpit batches after loading. Other endpoints: Jazz2 3,000; StarCraft 3,500; Blobby 1,100; QuakeII 1,400; Moorhuhn3 2,270.

The first four games run P/PC then PC/P in separate result directories. QuakeII and Moorhuhn3 run P/PC/PC/P then PC/P/P/PC. A separate MW3 P/PC pair explicitly passes the runner's existing `--cpu-window=1150:1750` flag to measure actual process CPU in the cockpit. An attempted addition of that flag to the isolated route driver arrived too late for the queued reverse runs; their logs contain no CPU-window output, so they are not treated as CPU-window measurements. The original pilot/reverse pairs have only the slice-wall measurement, which omits some cooperative work and must not be relabeled as CPU.

`tools/bench-fp-pc-games-report.js` requires completed routes and records three independent checks: pixels, API totals and uop counters. A row marked `acceptedFixedWork: false` is not accepted as evidence of an optimization gain. Raw timings remain visible to avoid silently discarding inconvenient observations.

## Results

Negative change means PC used less process user CPU. These are arithmetic means of independent launches, not FPS. Two or four samples per variant do not provide a precise estimate of sub-percent effects.

| Game | Runs per variant | P CPU | PC CPU | Change | Fixed-work gate |
|---|---:|---:|---:|---:|---|
| MW3 | 2 | 398.190s | 401.605s | +0.86% | Counter mismatch; pixels/API match |
| Jazz Jackrabbit 2 | 2 | 36.705s | 36.455s | -0.68% | Pass |
| StarCraft | 2 | 31.790s | 31.630s | -0.50% | Pass |
| Quake II | 4 | 13.190s | 13.408s | +1.65% | Pass |
| Moorhuhn 3 | 4 | 34.640s | 34.710s | +0.20% | Pass |
| Blobby Volley | 2 | — | — | Invalid | Pixels/API/counters differ |

Jazz2's pairwise changes were -0.25% and -1.12%; StarCraft's were -1.29% and +0.28%. QuakeII's within-variant ranges were 2.27% for P and 6.34% for PC; Moorhuhn's were 2.34% and 3.11%. These results do not establish a useful general game-speed improvement. All four accepted games match pixels, API totals and per-thread uop counters, including the repeats. Screenshots confirm Jazz2's demo level, the StarCraft Terran base, QuakeII gameplay and Moorhuhn's shooting field.

MW3 reaches the same cockpit frame and exactly 8,264,560 API calls at batch1,750 in all four initial launches. Its uop counters vary both across P/PC and across repeats of each individual artifact. That establishes a repeatability limitation, not proof that the variants execute identical internal work. The whole-route PC changes were +0.70% and +1.02%; do not promote a speed claim from these runs.

For the final 600 cockpit batches, the original main-instance slice-wall values were P 23.1/23.5s versus PC 22.9/22.7s (means 23.3/22.8s, about -2.1%). Startup dominates the whole route. These wall values are provisional and exclude some cooperative work; the separate CPU-window pair below addresses that measurement limitation.

Blobby's first pair appeared 12.5% faster but did different work; the reverse pair changed sign. Its same-artifact repeats also differ in counters. This route needs deterministic timing/input investigation before it can serve as a performance gate. Do not count it as either an optimization win or a demonstrated functional regression.

### MW3 cockpit process CPU

The explicitly configured final pair measured batches 1,150–1,750:

| Metric | P | PC | PC change |
|---|---:|---:|---:|
| Cockpit process user CPU | 22.751s | 21.874s | -3.85% |
| Cockpit process system CPU | 0.000s | 0.007s | — |
| Cockpit wall | 22.750s | 21.878s | -3.83% |
| Entire route process user CPU | 406.070s | 393.990s | -2.97% |

Both final frames are pixel-identical to the original cockpit frame, and API totals still match exactly. Uop counters still differ. The entire-route direction reversed from the earlier +0.70%/+1.02% pairs, while P's own total increased from 397.88–398.50s to 406.07s. **The -3.85% cockpit observation is promising but not an established speedup:** it is one directly measured CPU pair with a failed strict counter gate. Do not average these qualifications away or relabel this as a browser-FPS improvement.

All 34 runs completed. Twenty-four runs across Jazz2, StarCraft, QuakeII and Moorhuhn3 passed the strict pixel/API/per-thread-counter gate. Six MW3 runs match pixels/API totals but vary in counters. Four Blobby runs are unsuitable as fixed-work comparisons.

## Decision

Keep C experimental. It improves the copied projection kernel and may shave a few percent off this MW3 cockpit segment, but the expanded real-game sweep does not establish a broad improvement. Before promotion, make MW3's tier/work counters reproducible and repeat the cockpit CPU window; browser worker/WebGL measurements would be a separate validation. No production source or defaults were changed.

## Native review and kernel sanity check

Both exact modules were recaptured in V8 and SpiderMonkey158 on this EPYC host; matching ARM64 captures remain in the preceding matrix. Eager optimized V8 mixed bodies are both 19,840 bytes; Ion mixed bodies are P 8,432 / PC 8,424 bytes. PC retains its countdown (`add -1` in V8, `sub 1` in Ion) instead of independent index/limit comparison. Both still spill the counter; Ion also stores it and explicitly compares the stack slot with zero. The operation dispatch and guest memory-helper paths remain. These are structural eager-tier captures, not profiles of where game time was spent.

A fresh normally tiered projection-kernel pair measured P 79.982ms versus PC 67.998ms median thread CPU (-15.0%). This differs substantially from Ryzen's -3.4% incremental result and reinforces that the synthetic benefit depends on the host/code generation. It does not establish a whole-game improvement. The new-host eager disassembly must not be presented as the normally tiered kernel's exact code.

## Reproduction

Run with the frozen host checkout and restored fixtures, never a current host against these older modules:

```sh
node tools/uop-game-ab.js --no-build --games=mw3,jazz2g,sc,blobby \
  --arms=p,pc --arm=p=--wasm=build/lazy-games/fp-combos/p/candidate.wasm \
  --arm=pc=--wasm=build/lazy-games/fp-combos/pc/candidate.wasm --jobs=1 \
  --extra="--max-seconds=600 --no-threads --x87-fusion" \
  --extend=mw3:600 --out=build/lazy-games/fp-pc-games/pilot
```

Reverse with `--arms=pc,p` and a fresh output directory. For the cockpit CPU pair, use `--games=mw3` and add `--cpu-window=1150:1750` inside `--extra`. For QuakeII/Moorhuhn use `--games=q2,mh3 --arms=p,pc,pc2,p2,pc3,p3,p4,pc4`. The final validator can combine logs renamed with numeric repeat suffixes and checks comparisons across all repeats, not only each adjacent pair.

Artifacts are under `build/lazy-games/fp-pc-games/`, including the frozen modules' new-host V8/Ion captures, pilot/reverse/repeat logs, frames and host metadata. The earlier matrix contains matching ARM64 native captures for these exact hashes.
