# MIG-FP-KERNEL-PLAN

Owner `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, 2026-10-02 UTC. Read-only recipe following the original FP handoff and the coordinator's explicit planning request. **No copied-kernel timings, builds, modules or remote jobs were launched.** Both native capture sets are available; this plan keeps kernel acceptance separate from whole-game acceptance.

## Exact frozen inputs

Inspected local frozen runner `/private/tmp/wa-mixed-census-837f0a74`. It has no `.git`, so `837f0a74` is an inherited lineage label, not newly verified Git identity. The actual frozen kernel helper contains the required same-hash and `MIXED_CONTROL` branches and is byte-identical to the current main-worktree helper.

`scratch/mig-fp-kernel-plan-20261002/frozen-runner-hashes.json` pins all 110 frozen `lib/**/*.js` files, the kernel helper and EXE (112 entries). Its sorted `path + NUL + hash + newline` aggregate SHA-256 is `0ad6d09570e4e88cb2373d6588f96c0701ae4ac2c52e5cadc4b147a54f7ae576`. `preflight.json` records exact paths and helper hashes. Recheck this manifest before staging or running; do not substitute current dirty runtime libraries.

| Input | SHA-256 |
| --- | --- |
| Frozen `tools/bench-mw3-mixed-kernel.js` | `fca488ed15f5d6f4717a06574ee9176d074c42dfa4437eb207f663acc1ad399b` |
| Frozen `lib/host-imports.js` | `f2ccee2c78897f92b6c0751177045b8cb31a63ae1a2a0b313c1c7daca0625a24` |
| Frozen `lib/pe.js` | `f761e6b43c0a24bb60e8cec53e9e65401a997530f20d61edd2cdaf40fb8cc85c` |
| Frozen region-map mirror | `3d846e26c44ba8deb7f1cc9b97890c387f521400120f089548d850d8e24a8453` |
| Original MW3 EXE | `df457ee6973f6f9d557c57aa3fc14258303486ec8b8742fd37b4369c1f37dbdc` |
| P control | `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b` |
| PCM | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` |
| PCP | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` |

Primary proposed execution host is the handed-off ASCII Ryzen x64 box, **only after a new explicit quiet benchmark-slot grant**. Its verified Node is `/home/user/.nvm/versions/node/v24.18.1/bin/node`, V8 `13.6.233.17-node.50`. It has no current browser job after the completed baseline, but repeat process/load checks at execution time; that observation is not a standing lease.

Stage a fresh `/home/user/mig-fp-kernel-20261002` fixture from the pinned local frozen `lib/` files, its exact kernel helper and EXE at `test/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe`. Preserve relative layout because the helper resolves host imports and EXE relative to `__dirname`. Use the exact captured modules under `modules/{p,pcm,pcp}/candidate.wasm`; verified remote copies already exist in `/home/user/mig-fp-native-20261002/modules/`. Verify every staged manifest/module hash. Do not overwrite `/home/user/mw3-profile/repo`, the old frozen local runner, or existing result directories. No new runtime-source overlay is required. If a dependency is missing, report it; do not install or substitute dirty libraries silently.

## Work and correctness gates

The helper copies original EXE projection bytes at guest VA `[0x4fd394,0x4fd3e0)`, initializes fixed inputs, and enables pipeline4 fusion, island predecode and uop. Each arm owns 512MiB WASM memory, so one pair needs roughly1GiB plus compiler/host overhead. Run one process at a time.

Use `MIXED_VERTICES=50000`, `MIXED_ROUNDS=6` without tuning between arms. Each invocation executes two ordinary/edge-input parity runs per arm, twelve warmups per arm, six alternating ABBA/BAAB rounds (24 measured executions total), final state equality and one handler census per arm: 54 kernel executions per invocation. The three-invocation sequence therefore has 162 bounded-work kernel executions. `e.run(10000000)` must return with EIP0 every time.

Order: **P/P first**, then P/PCM, then P/PCP. Abort at the first failed or timed-out invocation; retain logs and do not silently rerun.

- Same-hash P/P uses its dedicated census-equality branch and provides a current same-host null/control reading.
- Different-hash P/PCM and P/PCP require **`MIXED_CONTROL=1`**. The actual frozen helper asserts control handler3 and handler65 counts are zero, then requires exact census equality between arms. Without it, the legacy branch wrongly expects these already-absorbed pointer ADD/DEC handlers to disappear again.
- Ordinary and edge parity compare output-buffer SHA-256, EAX, relative ECX/EDX/ESP, x87 top/tags/status and lazy-flag fields. Final state equality is checked again after measurement. These are the actual recorded fields, not a claim of every architectural register.
- Census covers handlers3,64,65,188,189,190,451. Preserve the whole JSON, per-execution island counts, node/V8/arch, module hashes and sample ordering. Require advancing island counts and equal work; a zero-coverage run cannot evaluate an island optimization.
- This is a **mixed projection kernel**. It does not establish isolated PCP pure-path coverage or effectiveness. A P/PCP result here is a mixed-work control observation, not acceptance of the pure countdown. Native pure-loop inspection is separate structural evidence. Do not invent a pure-kernel timing result from the mixed census.

## Quiet-host preflight

Before launching, record UTC time, exact Node/V8/architecture/CPU identity, `uptime`/load, available memory and a sanitized process snapshot. Confirm no other claimed benchmark, compiler, browser or emulator job uses the host, and coordinate ownership rather than stopping foreign processes. Require sustained idle headroom on the four assigned vCPUs; load alone is insufficient. If busy, defer rather than compare contaminated samples. Record load again between pairs and at completion; flag interference and do not make a speed claim inside the P/P noise band. Do not compare absolute values to the previous EPYC box or an ARM64 run.

## Exact bounded launch recipe, not executed

From the fresh staged remote fixture after hash/preflight acceptance, the following wrapper runs exactly the three pairs with one log pair each. It allows 180 seconds per process, then up to10 seconds for SIGTERM cleanup; SIGKILL is only a final guard for that newly created child if it cannot exit. It never signals other PIDs. Maximum waiting budget is **570 seconds** across three invocations, plus small orchestration overhead; stop immediately on any failure. There is no normal kernel `--max-seconds` option, so the supervisor is necessary to bound an unexpected stuck WASM call.

```python
import os, pathlib, subprocess

root = pathlib.Path('/home/user/mig-fp-kernel-20261002')
out = root / 'results'
out.mkdir()  # fail if already present
env = dict(os.environ, MIXED_CONTROL='1', MIXED_VERTICES='50000', MIXED_ROUNDS='6')
node = '/home/user/.nvm/versions/node/v24.18.1/bin/node'
for label, candidate in [('pp', 'p'), ('p-pcm', 'pcm'), ('p-pcp', 'pcp')]:
    args = [node, 'tools/bench-mw3-mixed-kernel.js',
            'modules/p/candidate.wasm', f'modules/{candidate}/candidate.wasm']
    with (out / (label + '.json')).open('xb') as stdout, \
         (out / (label + '.stderr')).open('xb') as stderr:
        child = subprocess.Popen(args, cwd=root, env=env, stdout=stdout, stderr=stderr)
        try:
            code = child.wait(timeout=180)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            raise SystemExit(f'{label}: timeout; stop sequence and preserve evidence')
        if code:
            raise SystemExit(f'{label}: exit {code}; stop sequence and preserve evidence')
```

Equivalent per-pair child command is `MIXED_CONTROL=1 MIXED_VERTICES=50000 MIXED_ROUNDS=6 NODE tools/bench-mw3-mixed-kernel.js modules/p/candidate.wasm modules/CANDIDATE/candidate.wasm`. The wrapper adds the deadline and fresh-output requirement; no arguments or gates are changed. Verify Python3 is available before scheduling; no install is part of this plan.

After success, parse all three JSON files, verify recorded module hashes, vertices/rounds/parity/census/island coverage and 24-sample ABBA/BAAB ordering. Treat medians together with paired spread and the P/P null; no automatic default change or broader campaign follows. Hash/download the complete result bundle and release the host before interpreting or preparing further work.

## Calendar spelling and later game gates

Verified in actual `tools/bench-mw3-repeat.js` and `tools/bench-fp-filetime-pin.js`: the variable is **`FP_SHARE_CALENDAR=1`**, not `FP_SHARED_CALENDAR`. The repeat tool records `sharedCalendar`, loads the preload when this variable is set, and the preload forwards `wallNowMs` through the frozen worker-import seam. The seam has its own uniqueness assertion; do not apply it blindly to a newer runtime already containing that key.

The copied projection kernel does not execute the whole-game calendar route and does not use this flag. Do not add it as a substitute for kernel parity. Later game acceptance is separately bounded by the repeat tool's route/work-window guards, matching screenshots/API/tier-counter evidence and same-host P/P controls; the prior instrumented SwiftShader browser run does not satisfy new PCM/PCP game performance acceptance.

Inspected current game helper hashes are retained in `preflight.json`: repeat `b6f1953fdf8956d0c99443b2b7c022003d27c6e110f49da6b3454e227594e4c3`, report `12b1489a6b69469e679d923f7fa78025ff2763404ba81a5d2024a52dd1e4d252`, calendar preload `28c5e68b7ff6f543d5a0307ac0039509d02fec4eb2d76ea51fd8093a97f68e51`. These are provenance for future planning, not authorization to launch game windows now.

No timings were launched, no slot is held, and all modules/defaults remain unchanged. The exact next action is coordinator review of this recipe and an explicit bounded host assignment if it should run.

Shared worker board watcher exec1072 stopped via Ctrl-C, terminal130, after browser handoff and this plan. No retained worker processes remain; both handoff diff checks passed.
