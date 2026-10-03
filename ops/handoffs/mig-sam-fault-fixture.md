# MIG-SAM-FAULT-FIXTURE

Worker `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-02 UTC.
**Two diagnostic baselines executed: expected semantic failures; CPU released.** Own new
`test/test-rep-movs-fault-restart.js` only; no production, existing-test or
tier-file changes. No remote work. The initial static-only stage was followed
by the separately coordinator-granted serial local baselines below. No subagents.

## Minimal cases and scope

Default case is real decoded `REP MOVSD`, DF0, destination absent page after
three successful elements, cold threaded block, ordinary raw guest SEH handler.
`--width=2` independently reaches the separate `th_rep_movsw` implementation.
The default `--fault-mode=3` explicitly enables the existing diagnostic miss
policy. Expected semantic failures here are **diagnostic-path baseline reds**,
not evidence that default production mode0 raises or recovers.

The proposed later production REP-specific policy needs a distinct mode0
acceptance run. `--fault-mode=0` is provided but not requested in this first
runtime grant. It retains the same strict AV/recovery expectations; there is
no sentinel-mode compatibility PASS disguised as recovery.

Guest handler flow:

1. Save actual EXCEPTION_RECORD fields and CONTEXT EDI/ESI/ECX/EIP/flags plus
   EBX/EDX/EBP, and pre/post instruction markers into ordinary guest memory.
2. Before repair, save every mapped destination/guard byte. Completed elements
   must match the original source; uncompleted/failed-element bytes must keep
   their sentinels. Bytes on an absent page are explicitly not readable or
   claimed as observed; straddle cases check the still-mapped fragment.
3. Execute an actual guest `VirtualAlloc(hole,4096,MEM_COMMIT,PAGE_READWRITE)`
   thunk, restore the source bytes or destination sentinels erased by fixture
   decommit, then mutate one already-copied source byte when k>0.
4. Return ExceptionContinueExecution without changing saved CONTEXT EIP or
   progress. Assert precise prefix restart, no repeated pre-REP instruction,
   no recopy of the mutated completed element, one post-REP instruction,
   correct final pointers/count/flags/guards and no unhandled exit.

The appended WAT exports only set up VirtualAlloc/VirtualFree mappings, expose
the mapped predicate, and allocate an ordinary API thunk using its current
`api_table.json` ID. No fault, PC, REP or SEH production text is replaced.
Record observations are saved by x86 handler instructions, not fabricated by
a host callback. Each run has bounded slices and repeated-miss refusal.

## Parameterized coverage and remaining cases

`--matrix` generates 80 combinations: widths1/2/4 × DF0/1 × source/destination
hole × cold/cached × k0/3, with aligned elements and additional straddles for
widths2/4. Cached cases warm the identical code with mapped pages, reinitialize
data on separate pages, then decommit the operand page; instruction bytes
remain unchanged. Matrix execution stops at the first failure.

Single-case flags: `--width=1|2|4`, `--df=0|1`,
`--operand=source|destination`, `--completed=0|3`, `--cached`, `--straddle`,
`--handler=plain|mov-eax|scope-like`, `--fault-mode=0|3`.

Handler variants deliberately test raw `MOV EAX,imm` and raw registration
adjacent words resembling a CRT scope table. These are negative classifier
probes; paired supported CRT/C++ positive controls remain needed before a
classifier change. Scope-like uses mapped scope-table pointer and trylevel=-1.

Not yet implemented: zero-count/no-access, both operands absent precedence,
overlap/LZ copies, independently forced noncontiguous mapped backing, code
write invalidation, wrap arithmetic, ContinueSearch/refault/nested cases,
real CRT/C++ positive classifier fixtures, and **all optimized execution path
coverage**. Uop and block execution are explicitly disabled; do not infer
optimized coverage from the cached threaded case. PAGE_* protections,
address16/code16, generic load/store precision and application replay are
outside this fixture's current scope. The full plan remains
`ops/handoffs/mig-sam-fault-plan.md`.

## Read-only execution-path/classifier audit

* `07c-block-exec.wat` has three REP_STR paths at approximately5434/6473/7307.
  They publish all eight registers, call byte/dword MOVS helpers and reload
  registers. None passes a REP instruction PC. The separate MOVSW handler is
  outside these four byte/dword MOVS/STOS selector arms. No direct
  `eip_redirected` reference was found in that file; runtime evidence is still
  needed for how a helper's exception exit propagates through outer dispatch.
* Uop kind30 recognizes widths1/2/4 with32-bit addressing. It emits COPY with
  `$uc_xstub`; `$uc_x_eip` comes from the instruction record's prefix start.
  `uop_bulk_slow` validates whole spans before writes and returns that stub
  on failure. The stub reconstructs recorded state via `uc_rec`, spills
  outstanding stack state and emits EXIT at that EIP. Page decommit clears
  PTEs and bumps the window epoch. This supports the proposed narrow PC route
  statically but does not prove cached deopt or fault continuation correctness.
* `seh_walk_from` classifies any handler starting0xB8 as C++ and skips it for
  hardware exceptions before reaching the raw fallback. The later
  `seh_frame_is_msvc` also guesses from adjacent registration words. The
  private all-AV shortcut is after0xB8 and cannot resolve both problems;
  copying it would bypass genuine CRT behavior. No classifier policy changed.

## Frozen inputs and first runtime prerequisites

Evidence directory: `scratch/mig-sam-fault-fixture-20261002`.
`identity.json` and `manifest.sha256` describe165 files /21059367 bytes.
`frozen/` contains their exact bytes, including all current source WAT/WATX,
API metadata, fixture/setup compiler harness, canonical compiler closure and
four VM compiler files, statically reachable relative host-library imports,
and `test/binaries/notepad.exe`. Literal relative imports had zero unresolved
paths. `preexisting.patch` and `source-status.txt` preserve the dirty source,
compiler/host and existing SEH-test baseline; no hunks were reset.

Fixture SHA256:
`f53d63edd646d4707ce59e877bded5205b3c050142b92703fe150fe0471fd928`.
`node --check test/test-rep-movs-fault-restart.js` passed before the baseline
grant. Subsequent compilation/runtime results are recorded below.

Local first runtime should run from `frozen/`, so `compile-src` resolves its
frozen compiler and source closure. It writes no canonical module: compilation
returns bytes in memory and logs the resulting SHA256. Use installed Node
with shared memory/tail-call support, one512MiB shared WASM memory and compiler
headroom. Existing repository node_modules are found through ancestor lookup.
Static closure also sees conditional `pngjs`, `@node-3d/glfw` and
`@node-3d/webgl` imports; no graphics path is exercised or native graphics
installation authorized. No remote transfer is needed per latest assignment.

After explicit grant, run serially from that directory with independent logs
in the evidence directory:

```sh
node test/test-rep-movs-fault-restart.js
node test/test-rep-movs-fault-restart.js --width=2
```

Do not start the second case after a compiler/harness failure until diagnosed;
an expected production semantic red may be followed by the independently
authorized word case. Save exact exit/status and first failed assertion,
distinguishing setup/compile failures from actual guest-semantic failures.
Do not run the full matrix or change production code. Recheck the165 frozen
hashes before and after. Source identity at freeze is documented; no claim
that unrelated live shared files remain frozen is implied.

## Granted diagnostic baseline results

Both authorized cases ran serially from the frozen directory, one source
compile/test at a time. Both compiled successfully to the identical emitted
module SHA256:
`02493f060c457e487d549058ee338b01a9fc8a8751e17bfb8b38e2a52d0d40c1`.
No module file or canonical output was written.

| Case | Session / exit | First assertion | Actual / expected |
| --- | --- | --- | --- |
| Default MOVSD, width4 | 70317 / 1 | actual guest raw handler called once | 5 / 1 |
| `--width=2` MOVSW | 15069 / 1 | actual guest raw handler called once | 4 / 1 |

These are semantic baseline reds after successful mapping setup, decode and
guest raw-handler execution, not compiler/setup failures. They establish that
neither tested diagnostic path meets single-fault recovery. They do not yet
establish which PC/progress/access-kind assertion would fail first: the handler
saved that state in guest memory, but the first assertion terminated the test
before later comparisons, and this initial fixture did not serialize the
snapshots. The terminated instances cannot supply those details retrospectively.
No assertion was weakened and no extra observation run was performed.

Evidence: `baseline-movsd.log`, `baseline-movsw.log`, and
`baseline-result.json` in the evidence directory. The result includes exact
commands, exits, source identity/manifest hashes and log hashes. All165 frozen
file hashes still match after both runs. Both exec sessions are terminal;
local correctness CPU is released. No matrix, mode0, optimized variant,
existing regression, source modification or remote run was performed.

Minimum justified next source proposal remains a **cold threaded REP-only
fault exit with explicit prefix PC and per-completed-element progress**,
covering byte/dword helper and separate word handler. Stop immediately before
the failed destination element and return to the existing raw continuation;
do not promote generic `g2w_miss` address heuristics. AV write-kind reporting
is also a known static dependency, but the present early failure did not reach
its assertion. These plain-handler cases justify no raw classifier change.
Before implementation, a narrow fixture-only diagnostic output grant could
serialize the first saved report, final markers and repair result before the
assertion, distinguishing restart/progress from repair-thunk failures without
relaxing expectations. Production ownership/implementation and that extra
run remain coordinator decisions; no new work is started automatically.

## Authorized observation follow-up (completed)

Coordinator subsequently authorized a test-only JSON dump before assertions
and exactly one repeat of each case. The original fixture/165-file closure and
logs remain unchanged in `frozen/`. `frozen-observed/` is a second165-file
closure differing only in the fixture; identities are in
`identity-observed.json` and `manifest-observed.sha256`. Current fixture SHA256
is `9d42ee3ee296bc5be6c9b0c5344f38fa79423c7cdccf1291ebf744f412b4d319`.
Syntax passed again; no expectation or guest instruction sequence changed.

Both repeats compiled to the same original02493f06 module hash and exited1:
MOVSD session71847, MOVSW session50036. Logs `observed-movsd.log` and
`observed-movsw.log` now serialize actual state; `observed-result.json` retains
the full records, mapped destination-byte snapshots, commands and hashes.

**Saved record/context values below describe the LAST handler entry, not the
first fault; earlier entries overwrite the report.**

| Observation | MOVSD | MOVSW | Expected |
| --- | --- | --- | --- |
| Handler calls | 5 | 4 | 1 |
| Saved ExceptionAddress / context EIP | `0x40e000` | `0x40e000` | REP prefix `0x40e00c` |
| Access kind | 0 (read) | 0 (read) | 1 (write) |
| Saved ECX | 7 | 4 | 4 |
| Saved ESI | 2130649152 | 2130649158 | MOVSD2130649164 / MOVSW2130649158 |
| Saved EDI | 2130579444 | 2130579456 | 2130579456 |
| Final pre-REP / post-REP markers | 2 / 1 | 2 / 1 | 1 / 1 |
| Guest VirtualAlloc return / hole | 2130579456 / mapped | same | repaired page |
| Host exits | none | none | none |

Both records contain AV code0xc0000005, NumberParameters2, correct absent
address2130579456 and flags0x202. Both return to EIP0 with ECX0 and final
ESI/EDI at the full-copy ends. This is not a correctness PASS: the handler
count, PC, access-kind and repeated pre-REP marker are wrong, and the MOVSD
last context also reports pre-copy progress. MOVSW's last context contains
the expected progress, but repeated handlers and stale PC still prevent a
restart contract. The observations distinguish successful page repair from
the incorrect continuation behavior; they do not prove every earlier nested
fault's state or an optimized-path cause.

This evidence supports the next **REP-specific precise prefix-PC + immediate
fault exit + completed-element publication + explicit write-kind** slice,
including the separate word handler. Preserve existing generic miss modes and
raw continuation. No classifier change is justified by these plain-handler
runs, and no mode0 or optimized correctness claim follows. Production edits
still require a new coordinator grant.

Both original165 and observed165 frozen file hashes match after the reruns.
Both owned processes are terminal. Local CPU released; no further runs,
source edits, canonical writes or variants started.
