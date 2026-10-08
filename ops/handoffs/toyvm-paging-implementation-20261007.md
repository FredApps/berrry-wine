# Ready task: TOYVM-386-PAGING-20261007

Implement generic paging needed by the original Comanche 3 installer. This is
an architectural correctness task, not a performance benchmark. Root owns the
task; start a fresh implementation worker when a slot becomes available. No
implementation is included in this handoff.

## Reproduction already authenticated

Main `2acadd964` records the investigation; `096e8d3a6` preserves the indexed
evidence under `scratch/runs/20261007-comanche3-paging-diagnostic/`. All 28 files
matched their recorded hashes. Root independently compared the three 16 KiB
regions: original INSTALL.BIN `[c97d,1097d)`, the guest read buffer
`[10000,14000)`, and physical memory `[0,4000)`. All match SHA-256
`a1014f71d8f0305296e65efa9c1062ce6df6868cce4c7623491846c7367770c8`.

The original address-size-32 REP MOVSD targets linear `10000000` while
CR0=`80000011`. Current translation masks it to physical zero and overwrites
the IVT. A timer interrupt then enters zero-filled code. The six-second run is
therefore derailed; a longer run is not the next experiment. Earlier main DOS
temporary-file and register-return fixes remain valid.

## Source boundaries to address together

The verified source is the 94-file closure at `4091453a`, indexed in the
evidence. Work from current origin/main, not the stale shared checkout HEAD.

- `tools/toyvm/emit.js`: `mov_r_cr` returns only CR0 and zero for other control
  registers; `mov_cr_r` discards CR3. `$lin` simply adds the segment base and
  masks by `$linmask`. Scalar/REP accesses, descriptor and interrupt reads,
  fault delivery, and exported helpers must use consistent translation.
- `tools/toyvm/dos-loop.js`: instruction fetch/decode and block identity use
  CS base, bus mask and D-bit. Introducing data translation alone would leave
  paged instruction fetch and cached blocks incorrect. Preserve physical code
  invalidation across aliases and translation changes.
- `tools/toyvm/decode.js`: decoder byte reads explicitly accept the address-bus
  mask; paged fetch must resolve guest linear bytes, including page boundaries.
- Audit `pm-transfer.js`, `dos.js`, `uop-live.js`, `uop-wasm.js`, `uop-ref.js`,
  `uop-only.js`, `region-live.js` and `tree-fold.js`: these also use linear/bus
  state or accelerated memory paths. Optimized execution must either implement
  identical semantics or explicitly hand back before executing unsupported
  paged work; it must never silently bypass translation.

## Acceptance and verification

Retain/read CR3 and implement PDE/PTE translation, permissions, accessed/dirty
state and architectural page faults with CR2/error code and restart semantics.
Establish the modeled CPU's exact semantics from primary architecture sources
before implementation. Coordinate instruction fetch, scalar/REP data access,
descriptor/interrupt memory access and cache invalidation. Do not mask missing
physical backing into another address or force paging off.

Use real execution regressions: high-linear mapped copies leave the IVT intact;
noncontiguous cross-page fetch/read/write; missing/protected pages and accurate
fault/restart state; CR3 changes and remapping; self-modifying physical aliases;
REP partial progress; non-paged/A20 behavior. Include optimized-tier correctness
where supported. A CR3-only patch or page walker used by only one access path
does not fulfill this task.

Run the appropriate ToyVM correctness suites and regenerate/check both browser
bundles with the full source closure. Then repeat the unchanged original
Comanche installer with bounded execution and inspect the later state. Reaching
installer UI is progress, not gameplay. Preserve source/media hashes, exact
commands, memory evidence and terminal cleanup in a self-contained run folder.

All browser runs and heavy benchmarks belong on a separate temporary box;
native correctness uses the serialized local slot. Keep disk above 2 GiB.
No Heroes II work, Claude-pane driving, shared HEAD/index mutation, public
deployment, binary patches or forced guest state. Commit exact paths from an
isolated worktree; root reviews and integrates.

## Executable starting regression

Root prepared `scratch/runs/20261007-toyvm-cr3-regression/cr3.js`, which runs
real guest `MOV CR3,EAX` / `MOV EAX,CR3`, stores the answer and exits normally
through DOS. Pass a source checkout as its argument. On the current main ToyVM
source (byte-identical to `4091453a`) it fails the named round-trip assertion:
written `00020000`, observed zero. The child exited1 for the assertion with no
timeout and was verified absent; the guest itself exited0. The self-contained
folder retains the COM bytes, driver, observation, output and terminal receipt.
Use this as the first before/after regression, not the acceptance suite for full
paging. It deliberately has not been added as a failing test to the main gate.
