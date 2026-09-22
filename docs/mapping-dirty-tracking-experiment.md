# Mapping dirty-page tracking: audit and first cost experiment

2026-09-21; production baseline `62f8332d`. Status: **not implemented**.

Native evidence in `test/fixtures/win98-file-mapping/native.serial.txt` shows
that separately created file sections retain independent bytes. An untouched
writable section must not overwrite another section's disk updates, but a dirty
page writes back its whole contents. The runtime's unconditional writeback
fails `node test/test-virtual-free-mapped-view.js --verify-writeback` at 4/4/0:
actual `[65,66]`, native `[27,66]`. Normal identity tests do not cover this gap.

## Write-path audit

These are inspected entry points, not a complete coverage census. A search for
every `store` also finds emulator-private registers/counters; those must not
mark guest pages dirty.

| Path | Evidence / integration requirement |
|---|---|
| Scalar CPU writes | `src/03-registers.wat` `$gs8/$gs16/$gs32` already carry guest address and width, including cross-page stores. A scalar hook alone is insufficient. |
| SIMD/MMX | `src/06c-mmx.wat` `$xmm_store128/$mmx_store64` lower to `$gs32`; ordinary stores there can inherit scalar tracking. |
| x87 | `src/06-fpu.wat` guest FST/FSTP use direct `f32.store/f64.store(g2w(addr))`; environment/extended-real helpers also write translated buffers. They bypass scalar helpers. |
| REP / folded bulk writes | `src/05b-string-ops.wat` range invalidation covers many fast copy/fill handlers, but generic span helpers and their callers need a separate coverage audit. Mark every destination page, not just endpoints. |
| Block executor | Inspected normal store cases call `$gs*`; generated/page-compiled paths and fused operations still require complete review. A raw store at the end of this file updates private profiling counters, not guest memory. |
| Native CRT handlers | `src/09a6-handlers-crt.wat` includes direct floating-point output and realloc `memory.copy` into guest buffers. API implementations cannot be assumed to inherit CPU-store hooks. |
| JS file I/O | `lib/filesystem.js` ReadFile fills translated guest chunks directly; its existing `invalidate_code_range` notification is an executable-cache operation, not a dirty-page contract. |
| Other host/API outputs | Need output-span review, including strings, structures, GDI and async completions. A read-only translation function cannot distinguish reads from writes. |
| Section initialization | Provider/eager initial fills must **not** count as guest dirties; a late fill must continue respecting initialized intervals and cancellation. |

Further required invariants: write-then-restore still dirties a page; writes
straddling pages mark both; release/reuse clears ownership and stale dirties;
COPY never writes the file; dirty reset/flush must not lose concurrent worker
writes. Atomic OR alone does not solve races between clearing the bit, copying
bytes, and a store performed after its dirty notification.

## Isolated experiment

`tools/bench-mapping-dirty.js` compiles two modules from the same source. The
candidate adds a scalar `$gs32` hook: fixture-specific direct-address rejection,
one byte per guest page, tracked-bit load, atomic dirty-bit OR. The control has
no hook. The 1 MiB table occupies unused PE staging memory in this no-PE fixture;
this is not a production allocation or proposed packed-PTE layout.

The benchmark asserts final stored values and actual tracking activation,
warms both arms, rotates execution order over nine paired samples, and supports
`--control-only` for A/A. It covers repeated aligned dword stores to one direct,
one sparse-untracked, and one sparse-tracked page. It excludes instruction
dispatch, games, cross-page writes, host writes, flush/clear races and complete
tracking coverage. Its address shortcut must not be copied into production.

Ran in `/private/tmp/wa-dirty-pages.Hu7Clr/tree`, a detached clean test worktree
at the baseline commit with ignored assets linked by `make-test-worktree.sh`.
Only the new benchmark script was transferred with `rsync`. Development stays
on main. Reproduce from that revision with:

```sh
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js
DIRTY_BENCH_ITERATIONS=20000000 node tools/bench-mapping-dirty.js --control-only
```

Node v24.21.0, arm64. The machine exceeded the project's load threshold of 4;
these measurements are exploratory, not release or game-performance evidence.
Raw paired samples and load readings accompany this report.

| Store target | Control median ms | Candidate median ms | A/B change | Separate A/A change |
|---|---:|---:|---:|---:|
| Direct window | 128.040 | 126.220 | -1.42% | -2.79% |
| Sparse, untracked | 204.796 | 213.586 | +4.29% | +0.96% |
| Sparse, tracked | 201.157 | 272.742 | +35.59% | -1.47% |

Twenty million identical stores/sample, nine paired repetitions after three
warmups/arm. A/B one-minute load was 7.50 → 8.45; A/A was 7.07 → 6.92.
The A/A columns are observed differences, not statistical confidence bounds.
Direct-window results do not establish a benefit. The tracked-store candidate
shows a large cost in this fixture, but this is not a predicted game slowdown.
Do not ship the naive atomic-OR-per-store prototype on these measurements.
Raw data: [mapping-dirty-tracking-samples.json](mapping-dirty-tracking-samples.json).

An initial two-million-store exploratory run was unstable: direct +25.23%,
untracked +2.06%, tracked +27.55%, load 5.56 → 6.35. Increasing sample work
changed the apparent direct-window result substantially. That discrepancy is
another reason not to treat this busy-machine measurement as a release verdict.

Next: complete output-span coverage and concurrent-flush design, then compare
candidate implementations on a quiet machine before integrating a hot-path
change. Game A/Bs remain required; this microbenchmark cannot select a default.

## Prerequisite fixed: scalar x87 store bypasses

The write audit reproduced an independent correctness defect: FST m32 at guest
page offset 0xffd wrote three bytes into the first backing extent but left the
last byte in the next guest page unchanged. The fixture deliberately places
unrelated backing between adjacent guest pages. Before the fix, storing 1.25
produced the wrong fourth byte (`0xcc` instead of `0x3f`).

FST/FSTP m32 now use `$gs32`; FST/FSTP m64 and both raw/converted FISTP m64
paths use a shared `$gs64`. MMX delegates its 64-bit store to the same helper.
The ordinary 64-bit same-page path translates once; boundary cases check
backing continuity and scatter through the existing dword helpers when needed.
These paths now also use the existing code-cache invalidation contract.

`test-sparse-width-boundary.js` exercises every crossing offset for the affected
widths, unchanged surrounding bytes, raw signed integers beyond f64's exact
range, and MMX stores. `test-sparse-generated-code-cache.js` checks that x87
32-bit, 64-bit and integer stores retire decoded destination code. The existing
FPU-instance isolation/raw-integer and SSE scalar regressions also pass.

This is a guest-store correctness/common-helper change, not dirty tracking.
Extended-real, environment/save-state, x87 loads, native CRT and other host
output paths still require review. The audit table above describes the original
benchmark baseline, which remains available at its recorded commit.

Logical-AND and region gates pass. The shared worktree's duplicate gate currently
reports two unrelated Direct3D SetTransform members from parallel edits. With
only these three changed WAT files copied into the temporary baseline tree,
the gate passes at 138/142 exact groups and 532/548 members. No ratchet baseline
was changed, and no full-build pass is claimed.
