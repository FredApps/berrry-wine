# Lazy DirectDraw Lock synchronization audit

2026-09-29, main `f3ec3a2f` plus the shared working tree. The experiment is
disabled by default. **Do not enable it globally yet.** This audit adds a
diagnostic reproducer; it does not change runtime behavior.

Follow-up: wide/x87 reads and SetSurfaceDesc backing replacement now have
runtime fixes and focused regressions. See the matched before/after results
in [lazy-sync-synthetic-results.md](lazy-sync-synthetic-results.md). The
cross-instance and retained-GDI findings remain open; default stays off.
The findings below describe the original audited revision.

Run `node tools/audit-d3dim-lazy-sync.js`. It compiles the canonical source,
uses real WAT access paths, and substitutes a deterministic GPU readback
(two RGB565 pixels, red/green). It reports observed hazards rather than
asserting that the current bugs are desirable. Eager and ordinary same-instance
lazy reads are asserted as controls. This is a unit-level access-path audit,
not another real-game performance run.

## Findings

### P1: ownership is local to an instance, but pixels are shared

`src/09ab-handlers-d3dim-core.wat`, `d3dim_lazy_*` globals and
`d3dim_lazy_unlock`; `src/03-registers.wat`, `g2w_slow`.

Instance A arms a surface. Instance B, instantiated over the same memory,
reads stale zero and writes `0x1234` through ordinary `gl16`/`gs16`. A still
reports an untouched Unlock. A subsequent readback replaces B's write with
`0xf800`. Both instances have the option enabled; B simply has no pending
range of its own. No concurrent scheduling is needed to reproduce this.

The shared uop epoch invalidates cached windows, but cannot make B see A's
instance-local range. Promotion needs shared ownership and a way for another
thread to synchronize the owning GPU executor, or an enforced runtime
restriction that drains/disables lazy sync before another instance can access
the memory. A benchmark assertion is not that restriction.

### P1: first-byte translation does not cover wide accesses

`src/06-fpu.wat`, `fpu_exec_mem` group 5/reg 0 and `fpu_load_mem`;
`src/07b-loop-match.wat`, `x87_pipeline_load`.

A real x87 `FLD m64` at `surfaceStart - 4` translates that starting address
once, then loads eight bytes directly. The surface start is page-aligned,
but this path never translates the second page. Lazy mode reads zero with
no fence and reports an untouched Unlock; eager mode reads bits
`0x07e0f80000000000`.

Thus the alignment fallback does not cover every scalar accessor. This is a
constructed overlapping access, not a measured MW3 pattern; it matters for
aliases/subranges of larger guest-owned buffers. Audit all raw wide loads,
x87 environment loads and folded paths. They need full-width span/access
validation, including a page-correct fallback, before default promotion.

### P1 for supported retained-DC use: native GDI bypasses the barrier

`src/10f-gdi-dc.wat`, `gdi_surface_descriptor` loads backing directly from the
surface entry; `src/09a4-handlers-gdi.wat`, `GetPixel` and `SetPixel`.

A previously bound surface DC reads stale black while a lazy Lock is armed.
SetPixel writes blue (`0x001f`) without any fence; Unlock still reports
untouched, and later GPU readback replaces it with red (`0xf800`). A new GetDC after Lock is safe:
GetDC performs a global fence. The reproduced case retains the DC from before
the arm. The emulator accepts that state; this audit does not establish that
holding a DirectDraw DC across Lock is a valid Windows application sequence.

Either reject/exclude incompatible outstanding-DC states at Lock, or fence
native GDI reads/writes by their actual backing range before rasterization.
Also audit selected DIB aliases and host-side consumers, which do not have
to pass through guest address translation. A write notification after drawing
is too late: readback must happen before the first partial write.

### P2: benchmark thread checks do not enforce the stated scope

`tools/bench-d3dim-gameplay.js`: startup enable at instantiate, thread checks
before and after measurement windows.

`--lazy-sync-startup` enables before the first thread check. A thread can also
start, touch memory and exit between samples; `.every(state === 'exited')`
then accepts the run. These checks detect some unsupported runs, but do not
prove that an accepted sample stayed single-threaded. Record thread creation
over the entire run and reject any such run, or enforce the restriction in
the runtime. Existing MW3 results are evidence for the observed route, not
a thread-safety proof.

## Paths reviewed without a new failure

- Same-instance `gl16`/`gs16`, full-span translation and partial-write ordering
  have focused coverage. The audit's ordinary read control synchronizes once.
- CRT `memcpy`/`memset` and kernel `RtlMoveMemory` use guest bulk helpers that
  validate complete spans through `g2w_affine_span`.
- Uop windows re-prove spans after the shared epoch changes on arm. This helps
  same-instance cached windows; it does not solve the ownership finding.
- Nested Locks drain before replacing the single range. New GetDC, ReleaseDC,
  Flip and final surface release retain global barriers. Texture Load fences
  source and destination. These observations are not an exhaustive lifetime
  proof: SetSurfaceDesc can change backing/pitch without draining first.
  The subsequent [browser synthetic suite](lazy-sync-synthetic-results.md)
  confirms a failure after an untouched Lock/Unlock: replacing the backing,
  reusing the old allocation and then fencing overwrites the reused bytes
  with old GPU contents. External backing aliases/free paths need further coverage.

## Order of work

1. Enforce the supported thread/DC scope and make benchmark coverage honest.
2. Close wide-access and retained/native-pointer barriers with regression tests
   requiring fresh reads and preservation of CPU writes.
3. Cover backing replacement, aliases, lifetime and reentrant/other-thread
   accesses; then repeat real-game off/on validation.
4. Consider a default only after those correctness checks pass.
