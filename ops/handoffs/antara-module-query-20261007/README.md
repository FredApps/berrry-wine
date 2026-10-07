# Win16 named module queries

Base: `ff8a2fa9a22f495a4897ba030e8a631210db492c`. This source checkpoint has
passed focused before/candidate and actual child-boot checks. **Mandatory full
build gates and the ordinary Antara installer rerun are pending.**

`GetModuleHandle` returned the task DS for any unknown/unloaded named module.
A caller testing nonzero could therefore skip its normal LoadLibrary. The fix
returns zero for a named miss and does not allocate registry entries while
querying. The existing built-in resolver is factored out without changing
LoadLibrary/import allocation. Real task resident names return the task
instance; loaded dynamic modules retain their actual handle. Existing null
selector/current-DS compatibility is retained, not broadened into a claim of
complete numeric-handle compatibility.

The original Antara child at segment3:10b5 queries SETUPL.DLL and skips the
LoadLibrary at10cc when the result is nonzero, then stores the handle into
DS108c. Actual attempt8 observed DialogBox102 with instance0087, a resource miss
and immediate AXffff return. That is established; the named lookup branch
remains a source-backed causal hypothesis until the corrected ordinary run.
No game-specific handle, resource redirect, guest state patch, or UI bypass.

## Validation

`node test/test-win16-module-query.js path/to/module.wasm` loads a small NE
fixture through the actual loader, applies real KERNEL47 import relocations
and executes segmented guest FAR calls. It checks unknown/unloaded names,
no registry allocation/exhaustion, task name/path, null, built-ins, and actual
loaded module identity. Extended coverage calls real WinExec166, lets the
production loader create a child start record, boots another actual instance
on shared memory, and checks child resident/null/miss/shared-DLL identities.
The host fixture only stages bytes and receives thread creation; it does not
implement module lookup or copy task globals.

Focused before module `a9a6ee13` failed the exact unknown-name assertion;
candidate `bb406cba3b1d55db253591c9e5e498db0b61cc42d6f52fcece05159a3f04cefd`
passed. Separate child extension passed on that same module. Receipts/logs are
adjacent. An earlier harness requested a mid-block breakpoint12 instead of
loop entry13; its pre-assertion failure is preserved in
`scratch/new-game-antara-20261007/module-query-validation/` and is not a
semantic negative control.

The new test uses automatic UNIT membership in `tools/test-tiers.js`; no
redundant exception was added. Full build plan additionally runs existing
Civ2 Win16 API, NE loader, image-extent, and authentic additive-FAR regression.
Source-only fullbuild readiness and targeted gate-input materialization are
in `scratch/new-game-antara-20261007/READY-module-query-production.json`.
