# MIG-FP-KERNEL

Owner `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, completed 2026-10-02 UTC. Coordinator-authorized exact P/P, P/PCM, P/PCP sequence completed once, serially, with all original correctness gates passing. No retries, extra sweeps, game windows, new modules or default changes. **Correctness and mixed-island coverage pass; performance acceptance remains inconclusive.** PCM has a consistent favorable wall-time observation in this bounded run, but thread CPU samples are too coarse and the same-artifact null is biased.

## Provenance and execution

Dedicated ASCII endpoint `user@37.59.33.130:19041`, pinned host key file `/private/tmp/fp-next-hosts`; fresh remote `/home/user/mig-fp-kernel-20261002`. CPU reports AMD Ryzen 9 9950X, four assigned CPUs. Explicit Node `/home/user/.nvm/versions/node/v24.18.1/bin/node`, actual v24.18.1, V8 `13.6.233.17-node.50`, x64. No renderer/browser or EPYC comparison is involved.

Inputs follow [the exact plan](mig-fp-kernel-plan.md): 112 frozen runner/EXE files from `/private/tmp/wa-mixed-census-837f0a74` plus three stripped modules, all verified locally before staging, remotely before execution, and again after execution. All 115 hashes unchanged. Frozen runner lineage has no `.git`; the content manifest is authoritative. Runtime-manifest aggregate SHA-256: `0ad6d09570e4e88cb2373d6588f96c0701ae4ac2c52e5cadc4b147a54f7ae576`.

| Input | SHA-256 |
| --- | --- |
| Kernel helper | `fca488ed15f5d6f4717a06574ee9176d074c42dfa4437eb207f663acc1ad399b` |
| Original MW3 EXE | `df457ee6973f6f9d557c57aa3fc14258303486ec8b8742fd37b4369c1f37dbdc` |
| P | `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b` |
| PCM | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` |
| PCP | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` |

Exact child commands used `MIXED_CONTROL=1 MIXED_VERTICES=50000 MIXED_ROUNDS=6`, explicit Node above, `tools/bench-mw3-mixed-kernel.js modules/p/candidate.wasm modules/{p,pcm,pcp}/candidate.wasm`, in that order. Supervisor adds 180-second child deadline, own-child TERM/10-second grace/KILL fallback, no retry, and first failure/interference stop. No signals were needed. Supervisor ran 03:13:05.709–03:13:52.306 UTC; SSH exec29018 exited0.

Initial preflight recorded ~99.8% idle over three five-second intervals, no scoped jobs, load0 and 7,276,364KiB available. After transfer/approval delay, supervisor repeated three five-second idle/process checks before **each** pair. Idle minima P/P96.495%, P/PCM98.848%, P/PCP99.600%; all exceeded the declared95% gate. One-minute load after pairs was0.037/0.028/0.021. No competing Node, SM, Chrome, Xvfb or listed compiler processes were detected. During child execution the supervisor polls sanitized process names every0.5s, excluding only its own child. These very short invocations can complete between polls; this is not proof against every transient or unlisted host workload. The initial memory check was not repeated between pairs. All own children exited0, final scoped process list empty; host slot released and foreign services untouched.

## Correctness and work

All three invocations passed ordinary and edge-input state equality, completion EIP0, final state equality, and exact census equality. The same-hash P/P branch and different-hash `MIXED_CONTROL=1` assertions executed unchanged. Every recorded parity and timed execution reports50,000 island runs. Each pair recorded24 timed executions in exact `ABBA BAAB ABBA BAAB ABBA BAAB` order, after12 warmups per arm. Overall162 kernel executions as planned.

For every arm in all three pairs, census is handler451=50,000 and handlers3/64/65/188/189/190=0. This verifies matched mixed projection work and already-absorbed pointer ADD/DEC. State comparisons cover output SHA, EAX, relative ECX/EDX/ESP, x87 top/tags/status and lazy flags, as documented in the plan; no claim of every register. This kernel does **not** establish PCP pure-path coverage or benefit.

## Timing interpretation

For each four-execution round, paired difference below is `100*(mean(B)/mean(A)-1)`. Negative means B used less time. Median is over six rounds; spread is observed min/max, not a confidence interval.

| Pair | CPU medians A/B ms (helper) | Paired CPU median; range | Paired wall median; range |
| --- | --- | --- | --- |
| P/P | 3.000 / 2.010 | -16.60%; -33.23..0.00% | -1.88%; -5.94..-0.99% |
| P/PCM | 3.000 / 3.000 | -16.51%; -16.83..+49.73% | -10.24%; -10.50..-9.04% |
| P/PCP | 3.000 / 3.000 | -0.09%; -16.54..+20.07% | -4.31%; -17.48..+4.92% |

CPU samples cluster near2 or3ms despite roughly2.5–2.8ms wall samples, consistent with coarse accounting at this duration. The P/P CPU null alone produces a large false apparent gain. P/PCM CPU paired median is essentially the same as that null. Its wall-time difference is consistently outside this run's P/P wall range, a useful observation but insufficient for a CPU speed acceptance decision from one short sequence. P/PCP wall spread crosses zero and overlaps the null; it is also only a mixed-work control. No statistical significance, whole-game benefit, hardware-GPU claim, or default recommendation follows.

## Evidence and next step

Complete local bundle: `scratch/mig-fp-kernel-20261002/`. It contains the exact staged fixture,115 input hashes, initial remote preflight, supervisor, launch stdout/stderr, compressed downloaded evidence, and `analysis.json` with every derived per-round value. `download/results/` contains all three full JSON results, three empty stderr logs and status/provenance. Remote `OUTPUT-SHA256SUMS` verifies nine downloaded files (seven result/status files, supervisor and input-verification log); all nine matched. The manifest itself is the tenth downloaded file, not self-hashed. Remote fixture/results remain preserved.

Exact next step: coordinator review of correctness pass and timing limitations. Any longer fixed-work measurement or different timing design requires a new bounded authorization; none was launched. Keep PCP pure-path acceptance and whole-game calendar/route gates separate. No benchmark slot remains held.

Own board watcher exec68114 stopped via Ctrl-C, terminal130. Handoff diff check passed. No retained worker process remains.
