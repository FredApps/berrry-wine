# Claude migration handoff: toyvm-uop (session 88bbcb9f-c099-48e3-b1e2-5f1a74dea00d)

Checkpointed 2026-10-02 under the ops-dashboard USER-REQUESTED CLAUDE MIGRATION FREEZE.

## Task

The user's goal: finish building the uop-only interpreter and benchmark it against L1, L1+uop and the
region JIT in toyvm. Binding rule: L1 stays in as the comparison arm. New engines are arms or
knobs, never replacements.

The latest line of work was making the live region JIT (`tools/toyvm/region-live.js`) pay off.

## Commits (all pushed to origin/main)

- 604c71b9: arm-bench `--l1-seconds`, plus the `jit-early` and `jit-r8` arms.
- b0f38372: `--region-jit-sep`, a regions-only module installed against the live instance's
  exports with no swap (`tools/toyvm/region-sep.js`, emit `exportAll`/`useBuild`), and the
  worker backend.
- deddbe2b: `--region-jit-continuous`, which re-profiles after an install, adds new regions, and
  makes the walk decline through installed region slots. Adds the `jit-sepc` and `jit-sepwc` arms.

## Latest results (box bx_xegf6upd, x86-64, node v20, ~30 s of L1 per program, 12 programs)

CPU time vs L1, geomean over the 11 clean programs:

| arm | CPU | run | build share |
|---|---|---|---|
| jit-early | x1.164 | x1.079 | 7.2% |
| jit-sep | x1.181 | x1.089 | 7.6% |
| jit-sepc (continuous) | x1.468 | x1.238 | 15.0% |

- **BRW DISAGREE in jit-sepc:** 500918117/2fa3dd95 against 500918116/a066bf27. This is an open
  correctness bug.
- Box logs: `/home/user/sepc30.{txt,json}` and `/home/user/sep30.*`.
- Diagnosis: region bodies are call-bound. Neither Ion nor TurboFan inlines any helper (~30 calls
  per DREAM region body), so per-iteration run time is not below L1.

## Next steps (not started)

1. Inline or specialise the helper bodies inside the region module.
2. Make the gate cheaper (~1 s per install).
3. Fix the BRW off-by-one under continuous mode, and the only-naive one.
4. Missing native captures: x86-64 for the region, and V8/SpiderMonkey for the new variants.

## Dirty files

None owned by this session; all of its work is committed. `test/test-toyvm-uop-live.js` shows as
modified but belongs to another agent and was not touched here.

## Tests last run

All PASS at deddbe2b:

- `test/test-toyvm-region-live.js`
- `test/test-toyvm-region-install-clock.js`
- `node tools/toyvm/bundle-browser.js --check` (up to date)

## Pending approvals

None.

## Processes and resources

- **Local:** none running.
- **Remote:** box bx_xegf6upd (91.107.229.168, host key pinned in the session scratchpad
  `known_hosts.box`). It is idle with no node processes, and `~/toyvm-ab` is detached at deddbe2b.
  This session released it and did not archive or delete it. Ownership is for the migration
  coordinator to reconcile.
