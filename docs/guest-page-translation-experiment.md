# Packed guest-page translation experiment

## Question

Wine Assembly's common image-relative and DIB guest addresses already use
constant-time arithmetic. Sparse `VirtualAlloc` addresses formerly used a
four-entry range cache followed by a linear map-record scan. This experiment
asked whether a packed page lookup was a useful foundation for later Win98
page-access auditing, without changing which accesses currently succeed.

It does **not** implement `PAGE_*` enforcement. Translation mechanism and
access policy remain separate so each can be measured independently.

## Candidate

The promoted implementation leaves direct and DIB translation unchanged.
Sparse mappings use one flat 4 MiB array with one four-byte PTE for every 4 KiB
page in the complete 32-bit guest address space:

```text
guest address 0xFEDCBA98
          | page index = (guest >> 10) & 0x003ffffc
          v
4 MiB PTE array --------------------> backing page | access bits
                                                + guest & 0xfff
```

Sparse commits always publish PTEs before the mapping becomes visible; release
always clears PTEs before backing can be reused. The shared table therefore
needs no per-instance enable flag or Worker-global propagation.

There is no runtime legacy fallback. A zero PTE is an authoritative miss and
goes directly to the normal unmapped-access result. The old four-entry range
cache, byte-page cache, record walk, enable flag, CLI/browser toggle, and Worker
inheritance plumbing have been removed. `VIRTUAL_MAP_TABLE` remains necessary
as allocation, release, and `VirtualQuery` metadata; neither WAT execution nor
the JavaScript host-boundary `g2w`/`g2wSpan` helpers scan it. Both translators
now consume the same packed PTE publication and treat a zero entry as an
authoritative miss. The JavaScript stack walker and diagnostic CString decoder
also call that shared helper instead of reimplementing image-relative
translation, so their DLL/sparse pointers follow the same address policy.
`lib/mem-utils.js` now also owns the single `guestToWasm` host entry point.
The browser host, renderer input, DLL/profile loaders, filesystem diagnostics,
OpenGL bridge, common host imports, cooperative scheduler and guest Worker all
call it instead of carrying private affine formulas; the renderer's last
allocation-record scan is gone. The helper prefers the instance's WAT export,
so this consolidation adds no branch to the interpreter's instruction hot
path. Its JavaScript fallback is used only while a host/mock lacks that export
and follows the same direct, DIB, packed-PTE and authoritative-miss order.

## Synthetic results

During the experiment `tools/bench-loops.js` supported a
`guest_page_translation` A/B toggle alongside `--mapping=sparse` and the
`sparse_scatter` shape. Results below use interleaved arms; positive numbers
mean packed lookup was faster. The production toggle was removed after the
decision; the sparse shapes remain as translator benchmarks.

| Sparse working set | Packed result |
| --- | ---: |
| Contiguous 2 MiB LUT loop | +0.5% |
| Contiguous 2 MiB store stream | +0.8% minimum; noisy median +4.8% |
| 1 scattered page | -7.8% |
| 2 scattered pages | +7.4% |
| 8 scattered pages | +19.0% |
| 16 scattered pages | +22.7% to +25.1% |
| 64 scattered pages | +45.6% paired median; +46.2% minima |

The result is the expected crossover: the established cache is excellent for
one hot affine mapping; packed lookup wins as the active mapping set exceeds
that cache. These are path upper bounds, not whole-application speed claims.

After rebasing the flat-table candidate onto current main, the two endpoint
controls were repeated with seven interleaved repetitions over 4 MiB. One
scattered mapping was neutral (packed minimum -0.1%, paired median +0.2%);
64 scattered mappings remained a large win (packed minimum +47.3%, paired
median +47.2%). This corrects the older one-mapping result above and shows that
the current implementation no longer pays a measurable hot-single-map tax.

## Application census and preliminary A/B

An eight-second launch census found 1 sparse mapping in Heroes II, 4 in
Heroes III, 10 in Diablo, 51 in StarCraft Shareware, and 57 in the Diablo II
demo. Fixed four-second cooperative runs then rotated off/on order to expose
host-load drift.

| Application | Packed handler-throughput pairs | Interpretation |
| --- | ---: | --- |
| Heroes II | -7.1%, +1.2% | inconsistent; effectively no demonstrated win |
| Heroes III | +12.4%, +14.8% | consistent preliminary win |
| Diablo | +0.8%, -4.9% | inconsistent; approximately neutral/slightly negative |
| StarCraft | -15.8%, +3.6% | host drift dominates; no conclusion |
| Diablo II demo | 0.0%, -0.07% | early startup is neutral |
| Diablo II gameplay | 139.99s off / 101.43s packed | one fixed-work pair: 27.5% less wall time, or 38.0% more throughput |

Diablo II also demonstrates why map count is insufficient: it has the largest
launch census but no startup throughput change. The first gameplay attempt
stopped at `Unable to start LNG manager` in both arms because the corpus
preloaded all three mutually exclusive renderers and exhausted the emulator's
16-slot DLL table before the game dynamically loaded `d2.lng`. Keeping the
selected DirectDraw dependency graph preloaded while mounting the unused
Direct3D/GDI/Glide renderers as on-demand files restored the original gameplay
gate without changing emulator-wide capacity.

The corrected replay performed the same 1,680 one-million-block batches in
both arms and captured the Rogue Encampment at batch 1,652. The two PNGs are
byte-identical (SHA-256
`c9becc47c222ac49e9609a1a817f0f75326c0e2e0e76192f4258226644fd70ff`).
Packed translation reduced externally measured wall time from 139.99s to
101.43s. This is a strong preliminary result, but it is still one pair rather
than a distribution and must not be presented as a stable gameplay speedup.

### Broader census

A second launch census sampled newer and non-Blizzard games with
`--dump-virtual-maps`. The count is the number of live sparse map records at
the sampled point, not allocated pages or memory traffic. It is useful for
choosing experiments but does not predict the result by itself.

| Sparse records | Applications |
| ---: | --- |
| 13 | Fallout demo |
| 8 | Half-Life Uplink |
| 6 | Age of Empires II Trial |
| 5 | Microsoft Commercial Multimedia demo |
| 4 | Quake II demo, GTA2 demo |
| 3 | Civilization II MGE |
| 2 | Deus Ex demo |
| 1 | Icewind Dale, RollerCoaster Tycoon, MechWarrior 3, Total Annihilation, Caesar III, Captain Claw, Jazz Jackrabbit 2, Darkstone, Cave Story, Little Fighter 2, Icy Tower, Elasto Mania, Abe's Oddysee demo, GeneRally, Jardinains, NetHack, QBob |
| 0 | Worms 2 demo, Pocket Tanks |

Several entries were still in an early or blocked launch phase, so these are
lower-bound snapshots rather than lifetime maxima. The main result is that
release year is not a useful proxy for sparse pressure: Fallout is the best
new candidate, while several later games still have one record. Alpha Centauri
was not a registered runnable corpus app at the tested commit and therefore
was not assigned a synthetic result.

### Repeated fixed-work controls

Each row below uses at least four legacy and four packed runs in a rotated,
interleaved order. Wall and user CPU medians are reported separately; the exact
batch count and input schedule were held constant. This is CLI translator
evidence, not a claim about headful browser frame rate.

| Application and sampled path | Legacy median | Packed median | Interpretation |
| --- | ---: | ---: | --- |
| Fallout demo, 8,000-batch early load | 1.125s wall / 1.255s CPU | 1.130s / 1.255s | eight runs per mode correct the shorter sample: neutral |
| Half-Life Uplink, 1,000-batch renderer startup | 19.055s / 17.275s | 17.495s / 16.460s | noisy preliminary 8.2% wall and 4.7% CPU reduction |
| Age of Empires II, 400-batch first-run flow | 0.310s / 0.325s | 0.320s / 0.335s | too short for a speed claim; effectively neutral |
| GTA2 demo, 4,500-batch gameplay entry | 9.080s / 7.715s | 7.715s / 6.830s | variance is large; neutral-to-positive, with no demonstrated regression |
| Quake II demo, 1,200-batch GL startup | 2.205s / 2.190s | 2.200s / 2.205s | neutral within measurement noise |

Correctness pairs reached the same fixed-work boundary in both modes. The
Fallout title, Half-Life startup, AoE II first-run frame, GTA2 Wild Demo frame,
and Quake II renderer frame were byte-identical between modes. GTA2 also ended
with identical thread/CPU state and execution counters; Quake II ended with
identical execution counters. The long Fallout pair had severe run-order drift
(56.41s/36.94s then 35.05s/22.32s). Doubling the short interleaved series to
eight runs per mode removed the apparent packed win; the table reports that
larger neutral sample.

## Why the flat table replaced the first prototype

The first demand-leaf design saves roughly 3MB but needs two dependent atomic loads,
has a finite leaf arena, indexes only the lower 2GB, and retains a legacy-scan
fallback. A follow-up replaced it with one 4 MiB array: one four-byte PTE for
every 4 KiB page in the complete 32-bit guest address space.

```text
guest address 0xFEDCBA98
          | page index = (guest >> 10) & 0x003ffffc
          v
4 MiB PTE array --------------------> backing page | access bits
                                                + guest & 0xfff
```

The first implementation failed its runtime gate immediately: using
`guest >> 10` without clearing its low two bits made non-page-aligned scalar
accesses issue unaligned atomic loads. Keeping that failure in the experiment
was useful—the corrected mask above is now exercised by cross-instance scalar
reads, releases, recommits, and an explicit mapping above `0x80000000`.

The same rotated sparse microbenchmark produced:

| Scattered mappings | Two-level result | Flat-table result |
| ---: | ---: | ---: |
| 1 | -7.8% | +0.9% paired median |
| 2 | +7.4% | +10.0% |
| 8 | +19.0% | +27.8% |
| 16 | +22.7% to +25.1% | +32.1% |
| 64 | +45.6% | +46.8% |

Those percentages compare each packed implementation with its own legacy arm.
Directly alternating the two packed artifacts made them effectively tied: the
flat table was 0.5% faster at one mapping and 1.4% faster at 64 mappings, below
this session's trustworthy threshold. The important result is therefore not a
speed claim between packed layouts. It is that the flat table retains the
fragmented-map win, removes the one-map loss, covers all guest addresses, and
needs neither leaf management nor a translation fallback.

Flat-table application controls remained neutral. Quake II's 1,200-batch GL
startup measured 2.580s median wall and 2.560s CPU in both arms. Fallout's
expanded 8,000-batch series is the neutral row above; a separate 32,000-batch
title pair took 13.51s/13.65s and produced byte-identical frames with identical
execution counters. Half-Life's eight-run-per-mode repeat measured 10.085s
legacy versus 10.110s packed wall time (10.505s/10.600s CPU), correcting its
earlier noisy apparent win to neutral. Quake II's flat-table off/on frames were
also byte-identical.

## Offline path census

`tools/build-page-translation-stats.js` builds a separately named,
instrumented WASM artifact. It atomically counts translation paths across the
main and guest-thread instances without adding a branch to the production
module. `test/run.js --guest-page-stats` reports the counters and rejects a
canonical artifact, so the census cannot accidentally be mistaken for an
ordinary benchmark build. After promotion its schema contains only the six
real production paths: direct, DIB, packed hit/miss, and packed affine-span
hit/miss. The legacy counters below are preserved historical evidence, not
paths the current tool can exercise.

The counters reset immediately before guest execution, excluding PE/DLL load
and packed-table backfill. These short runs are path censuses, not throughput
benchmarks—the atomic increments intentionally perturb timing.

| Application | Direct | DIB | Packed hit/miss | Legacy work in packed mode |
| --- | ---: | ---: | ---: | ---: |
| Heroes III, 3s | 60,785,583 | 390,177 | 542,328 / 1 | 0 |
| StarCraft Shareware, 5s | 80,309,409 | 3,702,407 | 3,189,735 / 0 | 0 |
| Diablo II demo, 5s | 142,114,125 | 14 | 65,416,844 / 0 | 0 |
| Alpha Centauri v4, 5s | 80,363,555 | 1,516,778 | 746,791 / 0 | 0 |

Diablo II's matching legacy run made 65,520,052 sparse-cache hits and 15,465
record-scan hits. Those scans examined 617,374 records, an average depth of
39.92. The first packed census still showed roughly 62 million legacy
translations because the option was applied only to the main WASM instance;
the declarative inherited-global table discarded it for guest-thread
instances. Adding `set_guest_page_translation`/`get_guest_page_translation` to
that shared table makes both cooperative and real Worker backends inherit the
option. Focused Worker tests and all three repeated packed censuses now show
zero legacy translation activity.

Alpha used the complete 395-file disc program tree with Firaxis's official v4
replacement payload layered over it, matching the diagnostic browser setup
that reaches gameplay. Its matching legacy census made 746,750 sparse-cache
hits and 41 record-scan hits; the scans examined 486 records (11.85 average
depth). This establishes its translation shape, not production installer
acceptance—the separate exact-disc path still has to run the original updater
inside the emulator.

The census also covers `$g2w_affine_span`, the bulk-operation helper that had
still used the legacy range cache/table even when scalar packed translation
was enabled. Packed mode now proves a span by checking every crossed PTE maps
to the expected contiguous backing page; it never enters the legacy span
cache or record scan. None of the short launch windows above requested a
sparse affine fast path. A focused backward `REP MOVSD` regression forces a
span across adjacent guest pages with non-contiguous backing and proves both
translators reject the unsafe fast path and complete through elementwise
translation instead. Separate tests cover contiguous, unmapped, zero-length,
and wrapping packed spans.

During A/B collection the browser exposed the same experiment as
`?guest-page-translation`, applied before the guest's first slice. A StarCraft
browser smoke run stayed live (four of five screen probes changed) and reported
the option enabled in both the main and spawned cooperative WASM instances.

StarCraft was then repeated under the project's acceptable host-load threshold
in rotated legacy/packed order, with a four-second warmup and five-second
sample. Legacy guest frame rates were 14.61 and 14.64 fps; packed rates were
14.99 and 14.59 fps. Their medians (14.63 versus 14.79 fps, +1.1%) are within
browser-run noise, so this is a neutral result rather than a speed claim. All
four runs stayed live at the same guest EIP and showed no frame-pacing
regression. The browser's instantaneous `stepsPerSec` snapshots varied by
multiple billions between otherwise equivalent runs and are therefore not
used as evidence.

Diablo Shareware used the same rotated 2x2 protocol at host load 1.97--2.27.
Legacy guest frame rates were 14.76 and 14.89 fps; packed rates were 14.98 and
14.74 fps. Their medians (14.82 versus 14.86 fps, +0.3%) are neutral. Every run
presented 152 full frames during the sample, remained live in the game's main
loop, and had smooth compositor pacing with no sampled interval above 33 ms.

After promotion, a normal browser launch with no translation query kept
StarCraft live (six of seven screen probes changed), exposed the 4 MiB table,
and no longer exported `set_guest_page_translation`. The query seam and its
cache-busted browser code were removed rather than retained as a hidden mode.

## Decision and integration

Promote the flat packed table and remove the legacy translator. The expanded
sample is positive or neutral rather than exposing a clear whole-application
regression. Quake II, the larger Fallout repeat, the current-main one-map
microbenchmark, StarCraft in-browser, and Diablo in-browser are useful neutral
controls. Large variance in GTA2 and the single complete Diablo II pair still
prevent a universal-speedup claim, but a universal speedup is not required for
the simpler authoritative translator.

The promoted branch always publishes and clears PTEs, removes the two sparse
translation caches and allocation-record scan, and deletes the CLI/browser and
Worker option plumbing. A focused release test proves byte reads cannot retain
stale per-instance backing, cross-instance tests cover publication and release,
and a rebuilt browser artifact keeps StarCraft live without the old setter.

The next memory-model step is optional audit/enforcement of `VirtualAlloc` and
`VirtualProtect` access flags on this one authoritative translator. Remaining
game runs now serve general acceptance and permission-policy evaluation; they
are no longer a gate for selecting between two address lookup implementations.

## PAGE_* metadata follow-up

The packed PTE now keeps the caller's validated `PAGE_*` value verbatim in its
low 11 bits and uses bit 11 as the private present marker. Sparse
`VirtualAlloc` publishes that protection on every committed page.
`VirtualProtect` rounds the requested byte range to pages, validates the whole
range before writing any PTE, and returns the first page's actual previous
protection. This follows Microsoft's documented all-or-nothing committed-range
contract and old-protection rule:

- <https://learn.microsoft.com/windows/win32/api/memoryapi/nf-memoryapi-virtualprotect>
- <https://learn.microsoft.com/windows/win32/memory/memory-protection-constants>

Private allocations reject `PAGE_WRITECOPY` variants, unknown bits,
`PAGE_WRITECOMBINE`, `PAGE_GUARD | PAGE_NOCACHE`, and modifiers on
`PAGE_NOACCESS`. Access checks are intentionally not enabled by this change.
Direct image/heap pages also remain permissive until PE-section and low-memory
page metadata can describe them. That separation makes the new metadata
observable and testable without putting a permission branch on the direct/DIB
translation paths or changing existing game execution.

## PAGE_* access-check performance prototype

On 2026-09-19 an isolated worktree at commit `0e43eff2` tested scalar guest
load/store enforcement before any change to main. The prototype routed
`gl8/gl16/gl32` and `gs8/gs16/gs32` through a runtime-selectable helper. For
sparse pages, that helper decoded presence, backing, and protection from one
atomic packed-PTE load. For direct pages, it also loaded the PTE so a
`VirtualProtect` override could be observed.

The quiet-host benchmark instantiated three artifacts in one process and
rotated their order across 21 repetitions:

- **A:** the current translator;
- **A2:** the new wrapper with access checking disabled at runtime;
- **B:** the same wrapper with access checking enabled.

Minimum-time and paired comparisons gave the following B-versus-A costs:

| Shape | Checked B versus current A |
| --- | ---: |
| Sparse scatter, 32 MiB / 64 pages | 3.5% slower |
| Direct LUT reads | 4.6% slower |
| Direct stack traffic | 4.3% slower |
| Mixed 8-bit memory block | 6.6% slower |
| Direct streaming stores | neutral, about 0.2% faster |

A2 was often slower than B. Consequently, a runtime option does not provide a
free disabled state: merely routing every scalar access through the extra
helper changes the hot path. These synthetic loops are upper bounds rather
than whole-application percentages, but the repeated quiet-host result is
large enough to reject this implementation shape.

A focused semantics probe passed read-only, no-access, read/write, and
cross-page no-partial-write cases. This was not complete Windows protection
enforcement: it covered scalar CPU helpers only, deliberately did not add NX
semantics (Win98 had no DEP), and did not implement `PAGE_GUARD`'s one-shot
exception-and-clear behavior. Raw/FPU helpers, string/bulk paths, and host API
buffer access still require a complete access census and exception design.

A paired Diablo II gameplay attempt was not a useful timing oracle on the
loaded local host. Both arms hit the approximately 300-second harness timeout;
their CPU totals were nearly identical (155.07 seconds current, 155.56 seconds
checked). Record this as inconclusive, not as either a game regression or a
game-level performance pass.

### Decision and next gate

Do not integrate the runtime-wrapper prototype. The next candidate must leave
the current direct/DIB fast path byte-for-byte or structurally equivalent and
fuse access checks only into translation paths that already load packed PTE
metadata. Direct-page `VirtualProtect` overrides need a separately measured
rare-path design, such as a monotonic "overrides exist" gate, rather than an
unconditional PTE load on every direct access.

Before integration, compare that candidate with current main in the same
process on a quiet host, repeat the focused protection probe, and run at least
one deterministic game workload with load-immune work counters. Correct
`PAGE_GUARD`/fault delivery and complete access-site coverage remain separate
correctness gates; they must not be inferred from this performance prototype.

## Access coverage audit and C1/C2 follow-up (2026-09-19)

Pinned source: `094bd919`; detached test worktree:
`/private/tmp/wa-page-perm-candidates`. The experiment compiles source transforms
with the canonical `test/compile-src.js`; no production memory helper is edited.

### Coverage and fault prerequisites

The access policy cannot be implemented by changing only `gl*`/`gs*`. A
comment-stripped call-site census of the pinned source gives:

| Source | Raw `g2w` calls | Scalar `gl*`/`gs*` calls | `g2w_affine_span` calls |
| --- | ---: | ---: | ---: |
| `05b-string-ops.wat` | 22 | 31 | 0 |
| `06-fpu.wat` | 24 | 7 | 0 |
| `06c-mmx.wat` | 0 | 29 | 0 |
| `07b-loop-match.wat` | 30 | 108 | 7 |
| `07c-block-exec.wat` | 0 | 67 | 0 |

These are syntax counts, not a claim that each call represents a distinct bug.
The required work is:

- **Scalar instructions:** validate the entire operand before mutation. A
  helper returning a scratch pointer is not an instruction abort.
- **FPU/MMX:** validate complete operands and save areas, including split
  stores and FPU stack changes. Two individually checked dword stores can
  still leave half of one instruction committed.
- **REP and folded loops:** span contiguity does not prove permission. Check
  every covered page and retain the architectural progress of completed
  iterations when a later iteration faults. Current REP loops update their
  guest index/count registers after the whole loop, so adding a trap inside
  the loop alone is insufficient.
- **Host APIs:** `guestToWasm` is an address translator, without access kind or
  byte extent. Buffer reads/writes need bounded, direction-aware checks and
  each API's failure behavior. Internal loaders/debuggers need an explicitly
  privileged translation path rather than accidentally inheriting CPU policy.
- **Instruction fetch/cache:** absence of DEP does not permit execution from
  absent, no-access, or guarded pages. Permission transitions must also affect
  previously decoded blocks, not just fresh instruction-byte reads.
- **Direct/DIB defaults:** an override-only PTE does not define the default
  protection or commitment of every direct/DIB page. PE section, heap, stack,
  and mapping metadata remain part of a complete policy.

`g2w_miss` explicitly allows the faulting operation to complete against
`NULL_SENTINEL` after calling `raise_exception`; `eip_redirected` abandons the
block but does not undo instruction side effects. Enforcement requires a
precise fault record, original instruction context, and an abort/retry path
before guest SEH can reliably repair a page and continue execution.

Microsoft documents the access-violation record's read/write indicator and
faulting guest address in
[EXCEPTION_RECORD](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-exception_record).
[Creating Guard Pages](https://learn.microsoft.com/en-us/windows/win32/memory/creating-guard-pages)
specifies a guard violation followed by clearing the guard modifier, and
distinguishes access during a system service. A shared implementation needs an
atomic guard transition; a per-instance flag cannot arbitrate two Workers.
These current documents establish the general contract; exact Win98 edge
cases still need the project's Win98 reference tests.

### Candidate definitions and focused validation

- **A:** pinned translator with the same test exports as the candidates.
- **C1:** separate read/write translation helpers preserve the original direct
  and DIB branches, then fuse checks into a single sparse PTE load. There is
  no runtime on/off wrapper.
- **C2cold:** C1 plus an atomic shared-memory gate on direct accesses, before
  the first direct protection override.
- **C2hot:** the same binary after a real direct `VirtualProtect(..., RW)`
  call. The gate is published before override PTEs and never cleared by a
  later protection restore, so this arm measures the enduring cost.

The prototype uses the unused word at `VIRTUAL_MAP_STATE + 28` at this pinned
revision for the shared gate. This is experiment storage, not a proposed
production ABI. C1/C2 deny with a WASM trap and leave guard state unchanged;
they measure lookup cost and are deliberately not a guest-SEH implementation.

Both candidates pass read-only, no-access, RW restoration and cross-page
no-partial-scalar-write tests on the local and remote hosts. C2 also passes a
two-instance shared-memory test: the second instance is initialized before
the first changes protection, observes the shared gate and read-only page,
rejects a write, and permits it after RW restoration while the gate stays set.

### Measurements and negative controls

On `fast-near-9tb-1`, 21 repetitions per shape rotated the four artifact arms
within one process. The direct shapes used 16 MiB; sparse scatter used 32 MiB
and 64 mappings. Positive values below mean **more elapsed time than A**:

| Shape | C1 | C2cold | C2hot |
| --- | ---: | ---: | ---: |
| LUT | +0.35% | +5.70% | +7.60% |
| Stack | +0.30% | +2.95% | +13.66% |
| Mixed block | -2.12% | -0.39% | +8.77% |
| Store stream | +1.18% | +1.37% | +6.85% |
| Sparse scatter | -2.78% | +1.74% | +3.88% |

The direct and sparse processes briefly overlapped; the host reported load
around 1–2. These are initial lookup microbenchmarks, not browser/game timings.

A second process measured C1 alongside **two instances of the exact same A
artifact**, again rotating 21 repetitions. All five shapes ran sequentially
in this process, using 16 MiB:

| Shape | C1 versus A | Identical A0 versus A |
| --- | ---: | ---: |
| LUT | +3.56% | +2.44% |
| Stack | +0.78% | +0.57% |
| Mixed block | +0.91% | -0.15% |
| Store stream | +7.41% | -0.17% |
| Sparse scatter | +1.29% | +5.84% |

This negative control retracts a stable C1 speedup/neutrality claim. Identical
artifacts can diverge between instances and the streaming-store result also
changed substantially. Rotating arms is necessary but does not remove all
instance/JIT/layout effects. A follow-up needs repeated independent processes,
identical-artifact controls, and native/inlining inspection before explaining
the small deltas as the cost of permission checks. Guest op/block counts agree
between arms; equal guest work does not prove equal JIT code or throughput.

**Decision:** C2's shared direct gate is not a free fast path and is not ready
to integrate. C1 remains an unproven performance candidate, not an accepted
optimization. Do not spend another long game timing sweep on these artifacts
until the controls and semantic coverage are resolved.

### Real-game control and missing-page isolation

The first C1 Heroes II gameplay attempt failed to complete the required 1,700
batches. Its Smacker `DllMain` trapped at EIP `0x76d6bf`; a diagnostic clone
identified access to guest `0x47240493`. The canonical A run passed the full
adventure-map test with 1,855 presents. The prototype had made missing sparse
PTEs trap unconditionally as well as enforcing mapped-page protection, so this
was not a clean isolation of `PAGE_*` checks.

`C1compat` preserves the original missing-PTE return to `g2w_miss` while keeping
the checks on present PTEs. Its focused scalar protection/cross-page tests pass.
It is a separate artifact and has **not** been timed by the tables above.
The C1compat Heroes II gameplay run then passed all 1,700 batches with exactly
1,855 presents and the same reported image-region statistics as A (map green
37.3%, map black 39.4%, panel wood 69.7%, panel green 0.8%). This isolates the
startup regression to the changed missing-page policy on this route; it does
not establish complete enforcement or browser performance.

Reproduction artifacts remain in the isolated worktree:

- `tools/page-perm-experiment.js`: canonical-compiler transforms for A, C1,
  C2, diagnostic D, and C1compat;
- `tools/page-perm-check.js`: focused tests, including shared instances;
- `tools/bench-loops.js --wasm-arms=...`: artifact comparison harness;
- `build/page-perm/page-perm-{direct,sparse,repeat}.json`: measurements.

Artifact SHA-256 prefixes: A `4bc97f6044ce7e5e`, C1 `6f77d5b912bd78cb`,
C2 `1a03f7eeb5896236`, C1compat `08c7ee756ccc04af`.

## Benchmark controls and precise retry probe (2026-09-19)

The next harness audit found that the artifact arms incremented one global
`repIndex`, so separate instances received different guest code addresses in
the same round. Independent instances now receive address index zero for the
census and `round + 1` for timing. Runtime-toggle arms that share one instance
still require separate addresses to avoid reusing another arm's decoded code.
The temporary harness also records every timing sample rather than only the
aggregate.

Three independent processes used `--no-liftoff --no-wasm-lazy-compilation`,
confirmed in that host's `node --v8-options`, to exclude baseline-to-optimized
tiering and lazy compilation. Each measured C1compat, A0 and A with nine
rotated repetitions and 8 MiB shapes. Identical-artifact controls still varied
by as much as 6.08%; matching guest addresses and removing tier-up therefore
did **not** establish a stable C1compat performance result. These are controlled
Node/V8 experiments, not a claim about Safari's JIT.

Three further processes pinned to logical CPU 2 with `taskset -c 2` also failed
the null control: identical A0/A differences ranged from -3.45% to +7.96%
across shapes/runs. This host is an Intel i9-9900K (8 cores / 16 threads),
running Node v20.11.1 on x86-64. CPU migration alone does not explain the
variance. These controls are retained as
`build/page-perm/page-perm-{controlled,affinity}-{1,2,3}.json` in the temporary
worktree; each file includes the individual timing samples.

A final three-process control cached `WebAssembly.Module` objects by artifact
SHA-256 and instantiated identical A/A0 arms from the **same compiled module**,
with eager optimization, matching guest addresses and CPU 2 affinity retained.
Positive percentages again mean slower than A:

| Shape | C1compat runs 1 / 2 / 3 | Identical A0 runs 1 / 2 / 3 |
| --- | --- | --- |
| LUT | -0.09 / +1.30 / +2.96% | -0.42 / +0.04 / +2.58% |
| Stack | -5.12 / -0.12 / -0.01% | -5.04 / -0.51 / +1.21% |
| Mixed block | -1.03 / -0.74 / -0.72% | -0.10 / +0.02 / -0.31% |
| Store stream | +3.76 / -0.79 / +3.25% | +3.07 / +6.51 / -0.48% |
| Sparse scatter | -0.23 / +2.82 / +2.71% | -1.79 / +0.36 / +1.46% |

Results: `build/page-perm/page-perm-module-{1,2,3}.json`. The board also reported
another agent's remote benchmarks during this work; the machine was not
exclusively reserved, despite sampled load around 0.6–1.6. Do not attribute
these variations to one cause: the controls rule out guest code-address
differences, tier-up, CPU migration, and separate module compilation as a
complete explanation, but do not isolate cache/memory placement or contention.
There is still no reliable small-effect permission-cost estimate. The mixed
block result is repeatable in these three runs but does not establish neutral
cost across the memory paths. Nine controlled processes have supplied enough
negative evidence to stop repeating this harness until a better isolation or
cycle-level explanation is available.

### Fault/retry probe

`tools/page-fault-retry-probe.js` in the isolated worktree executes real x86:

```text
0x00600000  INC EAX       ; EAX 41 -> 42, must remain completed
0x00600001  PUSH EAX      ; stack page read-only: fault here
0x00600002  POP EBX
0x00600003  RET
```

The protected stack pointer starts at `0x7eff0800`. C1compat traps with ESP
already decremented to `0x7eff07fc`, EAX correctly at 42, and the stack bytes
unchanged. `get_eip()` reports `0x00600000`, the block start, rather than the
faulting `PUSH` at `0x00600001`.

A temporary **P** artifact changes only `th_push_r` on top of C1compat:
calculate the prospective stack address in a local, perform the checked store,
then publish ESP. It traps with the original ESP intact. The probe repairs
the page through `VirtualProtect`, restores the saved EAX/ESP (the API call
itself changes them), explicitly supplies the exact fault PC, and retries.
`PUSH/POP/RET` then completes with EAX still 42 and the expected stack contents.
The test passes and deliberately exposes its limitation: the test driver,
not the emulator's current exception machinery, supplies precise fault PC and
context restoration. P is not integrated or a complete SEH solution.

### Proposed enforcement sequence

1. **Instruction identity:** retain a decoder-owned mapping from emitted
   threaded-op ranges to original x86 instruction PCs. Fused handlers need
   sub-operation PCs or must decline fusion in checked mode. Resolve fault
   provenance from that mapping; a block-entry EIP cannot support retry.
2. **Preflight and commit:** compute addresses/operands without publishing
   architectural mutations, validate every page touched by one instruction,
   then commit its stores/registers/flags. The PUSH probe is the first concrete
   example. POP-to-memory, RMW flags, MMX/FPU split accesses, and stack calls
   need the same review. REP preserves each completed iteration's progress;
   it cannot roll the entire instruction back after copying several elements.
3. **Fault transport:** carry `{code, guestAddress, accessKind, instructionPC}`
   per thread and abort the instruction before any further dispatch. Select
   and test an unwind mechanism supported by the canonical compiler and all
   target engines; returning `NULL_SENTINEL` is insufficient. Enter guest SEH
   only after the failed instruction has stopped, with a saved CONTEXT, and
   honor the handler's restored context on continuation.
4. **Shared transitions:** clear a guard with an atomic compare/exchange on
   the current PTE so one accessor claims that guard transition without losing
   concurrent protection changes. Fault retry must reload current metadata.
   Executable-page permission changes must invalidate or revalidate decoded
   execution across instances; a per-instance flag is insufficient.
5. **Boundary behavior:** CPU access faults, Win32 buffer-validation failures,
   and privileged loader/debugger access need explicit separate entry points.
   Keep legacy missing-page compatibility separate while testing mapped-page
   checks; the Heroes II startup control demonstrates why combining them
   obscures the cause of a regression.

The next correctness milestone at that point was an actual guest exception handler that
repairs a protected page and returns to the exact instruction, with unchanged
faulting-instruction state and retained earlier-instruction state. That is a
better integration gate than another launch-only permission smoke test.

### Guest-handler continuation prototype (2026-09-19)

That narrow milestone now passes in the isolated worktree, using
`node tools/page-seh-prototype.js` from
`/private/tmp/wa-page-perm-candidates` (base `094bd919`). It compiles
`build/page-perm/SEH.wasm` through the canonical compiler, layered on the P
experiment above. Neither the prototype nor permission enforcement is merged
into the production runtime.

The ordinary decoder emits a temporary instruction-PC marker before each
instruction. A denied access records the address/access kind and traps; a
temporary JavaScript fault bridge catches only marked faults, constructs a
guest EXCEPTION_RECORD and i386 CONTEXT control/integer subset, walks FS:[0],
and runs real guest x86 registration handlers. A handler calls the actual
VirtualProtect API thunk to make the page writable. Continuation restores
the guest-visible context and retries at the decoder-supplied PC, rather than
at a PC hardcoded by the test driver.

| Case | Observed result |
| --- | --- |
| Repair read-only stack page | Fault PC `0x00600001`; prior INC leaves EAX 42; faulting PUSH leaves ESP unchanged; repair/retry completes PUSH/POP/RET |
| Handler edits saved EAX | Restored EAX and the retried PUSH/POP result are 99 |
| Chained handlers | First handler executes and returns continue-search; second repairs and resumes |
| Architectural restoration | ESI survives handler scratch use; saved EFLAGS restored; registration-chain head retained on continuation |
| Search with no accepting handler | Explicit unhandled-exception failure |
| Invalid handler disposition | Explicit failure rather than accidental continuation |

All cases pass. This is a proof of the fault/repair/retry sequence, **not a
production SEH integration or a Win98 conformance result**. The marker adds a
dispatch per instruction and is not the proposed low-overhead PC side table.
Earlier whole-block/fused decode paths can bypass it; this probe establishes
precision only for its ordinary instruction stream. The bridge runs handlers
on a private scratch stack, not a validated Windows stack policy. It does not
cover floating-point context, nested faults, unwind, guard-page transitions,
concurrent threads, execute permissions, or all memory-access handlers.

The pinned production `src/11-seh.wat` also contains a separate blocker: its
scope-table path recognizes trivial filter byte patterns, then **assumes a
nontrivial filter accepts the exception and jumps to the except body without
executing the filter**. That shortcut cannot substitute for the general
registration-handler invocation and context continuation exercised here.
The prototype's JavaScript bridge deliberately substitutes for that walker;
passing this probe does not demonstrate that the production walker works.

Next: port this bounded handler-call/continue-search/context-restore contract
into the actual exception-dispatch path with regression tests, then cover
additional instruction commit points and fused-PC provenance. Keep the
performance question separate: no new timing claim follows from this probe,
and default permission enforcement remains off.
