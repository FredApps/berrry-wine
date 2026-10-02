# Handoff: fp-next root

- Owner: Codex `/root`, local parent PID 81503; board label `fp-next root`.
- Objective: measure new guest-execution ideas after P/PC work: browser/WebGL P baseline, isolate countdown to mixed (`pcm`) or pure (`pcp`) FP evaluators, then consider combined address/semantic dispatch. Require correctness, matching-work game measurements, and V8 + SpiderMonkey native disassembly for every variant on measured architectures.
- State: checkpointing at the ops-migration wind-down request. No new batches, variants or builds after acknowledging it. No default/runtime changes in this follow-up.
- Worktree: `/Users/vg/Documents/projects/phone/wine-assembly`, branch `main`, shared and heavily dirty. Do not infer ownership from status.

## Completed prior work

Commit `d7790a79` shares `wallNowMs` with cooperative threads, adds regression and repeatability tools/reports. Calendar mismatch was the MW3 repeatability bug. P/P then matched all 1750 recorded batch boundaries. Six unprofiled fixed-work cockpit runs matched pixels, API counts and per-thread tier counters. Balanced P/PC CPU 83.1945/84.5155 seconds: countdown +1.588%, no default change. These are EPYC results, not the current restored Ryzen host.

Prior reports: `docs/fp-mw3-repeatability.md`, `docs/fp-pc-game-followup.md`; raw artifacts `build/lazy-games/fp-repeatability/`. Exact frozen source `837f0a74`. P module SHA256 `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b`; PC `8e503d1e1588ca5292af82d63e56ba07eb6dca5d6c0803f161459b96fc8fb4d9`. Modules in `build/lazy-games/fp-combos/{p,pc}/`.

## Owned follow-up edits

- `tools/bench-fp-combos.js` (already untracked from prior experiments): add `pcm` and `pcp`, selectively rewrite countdown in mixed or pure evaluators only.
- `tools/bench-mw3-repeat.js`: accept those two variants and record only requested module hashes.
- `tools/bench-mw3-repeat-report.js`: recognize/summarize those variants, preserve existing six-run P/PC report case.
- This handoff. No follow-up commit requested or created.

Both modified repeat tools pass `node --check` and narrow `git diff --check`. No new game results exercise their added variant support yet.

## Current artifacts and validation

- `build/lazy-games/fp-next/pcm/`: completed isolated build from frozen 837f0a74, baseline reproduces exactly. Candidate SHA256 `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c`, 1651965 bytes. Named artifact and source retained.
- Completed PCM parity command: `FP_COMBO=pcm FP_ALL_FUSERS=1 node tools/bench-mw3-mixed-parity.js build/lazy-games/fp-next/pcm --fp-combos`. PASS fast == generic == unfused, **400 sequences / 14834 ops**, all with islands. This is the actual count, not the historical 1000-sequence configuration.
- PCP build still running at handoff drafting: process PID 74021, tool session 10265. Command `FP_COMBO=pcp node tools/bench-mw3-mixed-build.js 837f0a74 build/lazy-games/fp-next/pcp build/lazy-games/fp-combos/p/baseline.wasm --fp-combos`. Do not launch another build into that directory. Terminal status to be appended below.
- No PCM/PCP native captures or timings yet; no PCP parity yet. Local load exceeded 50, so do not make laptop timing claims.
- Browser failure artifacts downloaded to `build/lazy-games/fp-next/browser-p1/`: console, result.json, worker source and screenshots. Run terminated before gameplay. Console identifies **HTTP 404 for `binaries/shareware/mw3/ex/Program_Files/mech3demo.exe`**, followed by route-helper null `dstW`. The restored corpus archive did not supply the MW3 assets at that path. No valid frame windows. CDP confirms ANGLE **SwiftShader**, not hardware GPU.

## Remote ownership and safe resume

Dedicated ASCII box **bx_4r5uzdwv** was resumed; current endpoint **37.59.33.130:19041**, user `user`. Ryzen 9 9950X, 4 assigned vCPUs, Node24.18.1. Old EPYC endpoint is obsolete. SSH host key verified through authenticated box API, known-hosts file `/private/tmp/fp-next-hosts`. Public fingerprint source key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJo30ryGlJN+Oy+ZNkyI8a6ixiXjan5Qp2BolT2YfXmz`.

Remote frozen runner `/home/user/mw3-profile/repo`, module `/home/user/mw3-profile/p-next.wasm`; node_modules symlink to `../node_modules`. Browser worker already has the narrow frozen-source syntax fix. Assets archive `/home/user/mixed-corpus-assets.tgz` extracted, and `binaries -> test/binaries` created. Do not copy dirty production host sources into this fixture. Browser run session70398 exited1, Chrome/server harness cleanup completed through its finally path; no intended remote benchmark remains running. No local dev server started by this follow-up.

API helper `/private/tmp/mw3-box-api.py METHOD ENDPOINT [JSONFILE]` privately reads the existing credential; do not print credentials. GET `/boxes/bx_4r5uzdwv` verifies current state. POST `/boxes/bx_4r5uzdwv/stop` archives after downloading outstanding artifacts. Box remains retained for coordinator acknowledgment, not silently stopped.

Next after coordinator assignment:

1. Restore missing MW3 assets from local `test/binaries/shareware/mw3/ex/` to the identical remote path. Verify executable exists through the fixture HTTP server. Re-run the same browser P command into a **fresh** output directory, first confirming gameplay. Command: `DISPLAY=:0 CHROME=/usr/bin/google-chrome node tools/bench-lazy-games.js --app=mw3 --shipped-default --whole-profile --transfer-profile --seconds=20 --samples=3 --wasm=../p-next.wasm --out=build/lazy-games/fp-next/browser-p2` from remote frozen repo.
2. Finish/check PCP build, run its parity. Capture V8 and Ion native code for PCM/PCP plus matching P using `tools/bench-fp-native.js node|sm MODULE NAMED OUT` on ARM64 and x64. Inspect counter spills, calls and dispatch; no performance claims from structural code alone.
3. Run paired copied kernels, then matched-work game windows with `FP_SHARE_CALENDAR=1` and the extended repeat tool. Existing frozen CLI runner local `/private/tmp/wa-mixed-census-837f0a74`. Use P/P controls and pixels/API/tier-counter gates. Do not compare resumed-host absolute times with EPYC.
4. Only after evidence, decide whether to prototype fused address/semantic selector. It has not been implemented. ST(1) cache and finer integer-uop specialization are also unstarted ideas.

Retained pending acknowledgment: the narrow three tool edits, this handoff and `build/lazy-games/fp-next/`, dedicated remote box. Released: no production WAT/canonical-build claims, no dev-server port. No subagents exist. Board watcher tool session93409 / PID70373 belongs to this task; safe to stop only this watcher. Preserve all other agent processes.

Last updated: 2026-10-01 UTC.

## Terminal update, 23:35 UTC

PCP build completed exit0, candidate SHA256 `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b`, 1651965 bytes; matching frozen baseline assertion passed. Both named and stripped modules plus build.json retained. Sessions18077 (PCM),10265 (PCP),39256 (PCM parity),70398 (browser failure),3375 (artifact download) are terminal. No build or parity process remains owned. PCP parity/native captures and all new timings remain unrun under the wind-down instruction.

Remote process check found no benchmark harness or Puppeteer Chrome left running. Task board watcher93409/PID70373 stopped via its own terminal Ctrl-C. Dedicated box remains idle and retained for coordinator acknowledgment.
