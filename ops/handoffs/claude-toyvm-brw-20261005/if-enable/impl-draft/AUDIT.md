# Audit: does every toyvm arm honour the IF-enable boundary of IF-ENABLE-DESIGN.md §3?

Source-only, 2026-10-05. Nothing was run: no emulator, no test, no bench, no build.

The reference tree was built with `build-tree.js --tree=stack` (base 2683a6e3 plus v2v3j, v4
and smc; it printed dos-loop 74f94f3e, emit e07d99db, decode 57cbe0d9). Every `file:line` below
is in `tools/toyvm/` **of that unmodified stack tree**. Where the candidate changes a line, the
candidate's own location is named as "candidate".

The question for each arm: does the proposed mechanism make the arm hand back at exactly the
same guest instruction boundary, at exactly the same dispatch count, as the L1 interpreter? The
mechanism is:

- the decoder ends STI's block after the following instruction;
- `sti` arms `$ifarm`, and `CONT` refuses on it;
- `popf` and `iret` hand back when an IRQ is pending and IF=1;
- the host delivers at those handbacks with `clockAt = dispatched`.

## 0. Verdict per arm

| arm | as designed (§3 text) | with the candidate | decisive source |
|---|---|---|---|
| L1 interpreter: plain blocks | **no.** §3 puts the deferral in decode.js, but blocks are assembled in compile.js. A non-transfer follower then has no transfer to refuse at. | **yes** | compile.js:514-685 (block loop), decode.js:632/636 (HLT, STI); candidate `jmp_ifen` |
| L1: wasm decoder runs | **no.** It decodes a straight run past any boundary that is not a head. | **yes**: never used inside the shadow | compile.js:556-617, emit-decoder.js:554-555 (STI itself is declined) |
| L1: jmp_syn into an existing head | **no.** `CONT_SYN` reads only `$smc`, and the follower would sit in another block. | **yes**: the follower is decoded inline | compile.js:520-536, emit.js:747-753 |
| L1: traced Jcc (`extendThrough`) | **no.** A conditional follower is traced through. Its not-taken arm uses an inline `$smc`/`$steps` test, not CONT. | **yes**: no extendThrough on the follower | compile.js:209-247, 658; emit.js:795-803 (line 801) |
| L1: fused cmp/jcc | yes. A fused pair is the last two ops of one block, and STI is never one of them. | yes | compile.js:151-171, 668 |
| L1: spin collapse (jcc/jmp/port/gspin) | yes. Only a block that is one branch to its own head is collapsed, and STI's block is never that. The spin arms' inline tests (emit.js:831, 853, 3602, 3637) are never on the boundary. | yes | compile.js:703-744 |
| L1: REP widening | yes. The whole count runs in one dispatch and charges `$steps`. There is no mid-instruction handback. | yes | emit.js:1628-1700 |
| L1: TF single-step (`stepOne`, oneInsn) | n/a: one instruction per slice | the shadow is not laid out under TF; the host never delivers on an `end` handback | compile.js:666; dos-loop.js:1549, 1556-1558 |
| "folds via loop-match" | n/a. `loop-match.js` is a report tool: "NOTHING IS FOLDED HERE". | n/a | loop-match.js:28 |
| tree-fold, straight runs | yes. `sti`/`cli`/`popf` are flag-word barriers and `jmp_ifen` escapes, so none is ever in a run. A fold charges the run's steps exactly, and its terminator stays. | yes | expr-fold-census.js:231; tree-fold.js:295, 402-435 |
| tree-fold, loop and call trees | **no.** These go through `buildRegion` (see region JIT). | **yes**: they decline | tree-fold.js:628-655, 697-740 → region-jit.js:1252 |
| region JIT (`--region-jit`, region-live, region-prepare) | **no.** §3 says the region "inlines GO/CONT, so it inherits the refusal". It does not: lowered edges use the region's own `boundaryTest`. | **yes**: declines regions containing sti/popf/jmp_ifen, and the walks stop at them | region-jit.js:1329-1347, 1361-1366, 1680-1682, 1756-1764 |
| µop tier, live (`--uop`) | yes. Programs never execute STI, POPF, IRET or an SS load, and their heads are L1 handbacks. | yes (L1 runs the STI block) | uop-x86.js:127-131, 362; compile.js:382-393; uop-live.js:459 |
| µop-only (`--uop-only`) | **no.** The STI fallback is one instruction (`end` inside the shadow). `drive` treats `end`/`edge`/`ret` as clean and runs the follower as a µop program. | **yes**: shadow fallback, `$ifarm` check, `mid` rule, `iretMiss` | uop-only.js:53, 261, 275-276, 571-578 |
| host (dos-loop.js) | partial. It needs the pending mark, `irqpend`, eligibility from exitwhy plus ifarm, and the timer rung off-stop. | implemented, timer only | dos-loop.js:1766, 1836-1849, 1895-1901, 2089, 2106-2119 |

## 1. The threaded interpreter (decode.js, compile.js, emit.js)

### 1.1 Where a block ends is compile.js's decision, not decode.js's

- `decodeOne` decodes one instruction and reports `endsBlock` (decode.js:258, 1154). The block
  loop that consumes it is compile.js:514-685.
- STI is `words.push(H.sti)` with no `endsBlock` (decode.js:636). POPF carries the next ip for
  its TF exit (decode.js:566). HLT is `H.end` + `endsBlock` (decode.js:632). IRET is `endsBlock`
  (decode.js:998-999).
- So "defer endsBlock by one" (§3, item 1) cannot be done inside `decodeOne`. The candidate:
  - adds `sti` and `ssLoad` facts to decodeOne's result (decode.js, candidate);
  - lays the shadow out in compile.js's loop.

### 1.2 Places the loop could swallow the boundary, and what the candidate does with each

1. **The wasm decoder** (compile.js:556-617).
   - It stops only at a head, an unimplemented opcode or a full scratch (emit-decoder.js:656-698).
   - It implements ALU, 80-83, MOV 88-8B/C6/C7 and Jcc 70-7F only, and declines everything else
     (emit-decoder.js:554-555). So it already stops *before* an STI.
   - But it would decode a follower and everything after it in one run.
   - Candidate: never offered the run while `shadow` is set.
2. **"Reaching the head of a block we already emitted"** (compile.js:520-536).
   - When the follower's ip is already a head, the loop emits `jmp_syn`, and the follower runs
     in another block with no transfer after it.
   - `jmp_syn` tests only `$smc` (`CONT_SYN`, emit.js:747-753; fix J). So `$ifarm` would either
     be ignored there or, if it were added, refuse at the shadow boundary, which is forbidden.
   - Candidate: skipped inside the shadow, and the follower is decoded inline (one instruction
     duplicated).
3. **Volatile cut** (compile.js:543).
   - `end_cut` at a volatile follower would hand back inside the shadow. The uncached compile
     would then run the follower with no boundary after it.
   - Candidate: ignored inside the shadow. The bytes are in `covered`, so a store still raises
     `$smc`.
4. **maxWords cut** (compile.js:515). Candidate: checked once, before the STI is emitted
   (`IFEN_ROOM`), and suspended inside the shadow.
5. **extendThrough / traced Jcc** (compile.js:209-247, called at 607 and 658).
   - A Jcc follower would be swapped for its `_t` twin, with the not-taken edge laid out inline.
   - That arm's test is `$smc | $steps<0`, written inline rather than through CONT
     (emit.js:801). The not-taken boundary would never see `$ifarm`.
   - Candidate: a follower that ends its block just ends it, with no extension.
6. **Non-transfer follower.**
   - No existing op fits as the boundary transfer. `jmp` (emit.js:876-879) charges a step, so it
     would move the clock. `jmp_syn` does not read `$ifarm`.
   - Candidate: a new `jmp_ifen`. It is jmp_syn exactly (refunds its step, no budget test, the
     same GO_SYN), plus `if $ifarm → $gip = boundary, EXIT('ifen')`.
   - With `$ifarm` = 0 the block's charge and stop points are HEAD's.
7. **Region and µop heads marked up front** (compile.js:371-393).
   - A head at the follower ip would end the straight line there.
   - Candidate: covered by item 2. The follower is inline, and the head stays a head for every
     other path.
8. **Unimplemented follower** (compile.js:619-628).
   - `end` lands inside the shadow. That case is not fixable, but an opcode nobody implements
     ends the run anyway.
   - The host never delivers on an `end` handback (candidate `ifenExit`).
9. **16-bit wrap.**
   - The boundary could lie below the STI. `jmp_ifen` does not test the budget, so this is the
     jmp_syn wrap case (compile.js:529).
   - Candidate: the same refusal (`end_cut`).

### 1.3 Every transfer that would be the boundary when the follower is a transfer

These all reach CONT, so `CONT |= $ifarm` refuses them at the follower's target:

- GO (emit.js:695-699, cold arm `$jlook_edge` → CONT again, emit.js:5727-5732);
- GO_LOOKUP (emit.js:669-674: indirect, int fast path, iret);
- RET/RET_imm (emit.js:1085-1126);
- call_rel.

What CONT does not cover:

- **`jmp_syn`** (CONT_SYN): never at the boundary, by 1.2 item 2.
- **The traced not-taken arms, the spin arms and pspin** (emit.js:801, 831, 853, 3602, 3637):
  never at the boundary, by items 5 and 1.4.
- **32-bit far transfers**: hand back unconditionally (`far32`, emit.js:2478, 2488), and the
  host accepts `far32` when armed.
- **INT** (emit.js:1483-1494): its handler runs with IF=0, so the boundary is not eligible
  anyway, and the host clears `$ifarm`.

### 1.4 Fused, spin, REP

- **fuseTail** (compile.js:151-171) fuses only the last two ops of a block, and only pairs in
  `FUSE` (alu + jcc). `sti` + X and X + `jmp_ifen` are not pairs.
- **Spin collapse** (compile.js:703-744) requires a block that is exactly one branch op back to
  its own head. STI's block has at least `sti` + follower.
  - `sti; jmp $` is still correct. The `jmp` inside STI's block refuses on `$ifarm` (boundary =
    its target, the jmp itself). The self-loop block at that ip is collapsed separately, after
    the boundary.
- **REP widening** runs the count inside one dispatch (emit.js:1628-1700) and has no handback, so
  `STI; REP MOVSB` puts the boundary after the whole REP. The SDM allows a REP to be interrupted
  between iterations, but toyvm never does that anyway.

### 1.5 `cli`, `sti`, `popf`, `iret` bodies

- **`sti`/`cli`** are `setF` on `$flags` (emit.js:1281-1282). IF is outside the lazy set, so `$flags`
  is authoritative for IF (emit.js:1268-1275). Candidate:
  - `sti` arms iff `$irqpend && IF==0`;
  - `cli` clears `$ifarm`, so STI;CLI hands back nothing.
- **`popf`/`popf32`** (emit.js:1031-1063) test TF only. Candidate: `|| (irqpend && IF)`.
- **`iret`/`iret32`** (emit.js:1495-1550) already test `irqwant && IF`. Candidate:
  `(irqwant | irqpend) && IF`.
  - Both globals are 0/1. The existing `(i32.and (global.get $irqwant) <0/1>)` is bitwise and
    relies on that.

## 2. Region JIT (region-jit.js; also region-live.js and region-prepare.js)

**The design's claim "the region JIT inlines GO/CONT, so it inherits the refusal" does not hold.**

- **Lowered edges carry no `$ifarm`.** A lowered branch, jump or exit is cut out of its handler
  body and replaced by `edge()`/`edgeSyn()`, which use the region's own tests
  (region-jit.js:1329-1347):
  - `boundaryTest = $smc | $halt | $steps<0`;
  - `synTest = $smc | $halt`.
- **The back edge and the epilogue test other globals too.** The back edge (1361-1366) and the
  epilogue `leave` (1756-1764) test `$halt`/`$smc`/`$steps`. None of them reads `$ifarm`.
- **Inlined halting bodies run on.** Non-transfer op bodies are inlined verbatim
  (`resolveGoArena(t3.bodies3[i])`, 1680; `if (!branch) continue;`, 1682).
  - An op that sets `$halt` mid-region is noticed only at the next edge's test. That covers popf
    with TF today, and popf with an IRQ owed under the candidate.
  - So the ops behind it run inside the region where L1 would have stopped.
- **Unlowered transfers keep GO's text,** rewritten by `resolveGoArena`.
  - Its regex `GO_RE` (993-996) matches CONT's condition literally. Changing CONT without
    changing GO_RE would silently leave stale profiling-run arenas in every region with an
    unlowered transfer, which is the CARRIE.EXE class.
  - The candidate updates GO_RE to the new CONT text.

Candidate:

- `buildRegion` declines any op list containing `sti|popf|popf32|jmp_ifen` (`IF_BOUNDARY_OPS`).
  This covers tree-fold's loop and call trees and region-prepare.
- Both block walkers (`chainFrom.blockOps` at 202, `traceFrom` at 612) treat those ops like
  `int`. A whole region-prepare bundle declines on its first failing pick (region-prepare.js:94),
  so the walk must not pick such a path in the first place.

Cost: no region over a hot loop containing STI or POPF. The A/B must check whether any corpus
region was one.

## 3. µop tier

### 3.1 `--uop` (uop-live.js)

- Programs come from `uop-x86.js`. STI (0xFB), POPF (0x9D), IRET (0xCF), HLT (0xF4) and CLI
  (0xFA) all fall to `bad('op ..')` (uop-x86.js:362; flag ops are only F8/F9/F5, at :220).
- SS loads are refused by `segLoad` (uop-x86.js:127-131).
- So a program never arms or crosses a shadow. Its head is an L1 handback (compile.js:382-393),
  and L1 runs the STI block.
- `resume` (uop-live.js:443-456) re-enters an L1 block at the program's exit ip. That cannot be a
  follower, since the program would have had to run the STI.
- Budget test points: uop-ir.js:290-330 models L1's test points (jmp_syn fall-in untested).
  `jmp_ifen` adds a fall-in head with the same untested semantics, reached only from STI's block.
- **Honoured.**

### 3.2 `--uop-only` (uop-only.js)

This arm fails as designed, for four reasons:

- **The STI fallback hands back inside the shadow.** An STI site is a one-instruction L1 fallback,
  `compileProgram(.., {oneInsn: true})` (uop-only.js:571-578): `[sti][end next]`. Its `end` hands
  back INSIDE the shadow.
- **`drive` runs on past that handback, and past the follower's.**
  - `end`, `edge`, `indirect` and `ret` are clean handbacks (FB_ON, uop-only.js:53, 276).
  - So the follower runs next as a µop program or as another one-instruction fallback. Neither
    has a test at the boundary.
  - If the follower's own transfer refused on `$ifarm` (exitwhy `edge`/`ret`), drive would treat
    that as clean too.
- **The `mid` rule must see `jmp_ifen`'s pass-through as mid-block.**
  - `mid` treats a fallback's `end` with the budget spent as the middle of an L1 block
    (uop-only.js:261). That keeps the stop where L1 stops.
  - An STI fallback that ends in `jmp_ifen` passes through as `edge`, and the same rule has to
    see that as mid-block too. Otherwise uop-only would stop at the boundary when the budget
    runs out there, while L1 runs on to its next tested transfer.
- **`iretMiss` reads `$irqwant` only** (uop-only.js:275).

Candidate:

- the fallback compiles with `ifenShadow` (STI + follower(s) + `jmp_ifen`);
- `drive` returns to the session whenever `$ifarm` is still up after a fallback;
- `mid` also accepts `edge` at the fallback's own `jmp_ifen` target;
- `iretMiss` reads `irqwant | irqpend`;
- `drive` zeroes `$exitwhy` when it runs on past a clean handback, so a stale `iret`/`edge` never
  reaches the session's eligibility test.

## 4. tree-fold (tree-fold.js, handler-effects.js, expr-fold-census.js)

- **Straight-line runs never contain STI, CLI or POPF.**
  - `classify` makes `lahf|sahf|pushf|popf|..|cli|sti` flag-word barriers with no relaxation
    (expr-fold-census.js:231).
  - `jmp_ifen`'s body calls `$slice_exit` and `$jlook_syn`, which `ESCAPES` refuses
    (tree-fold.js:295).
  - A fold charges its run's steps exactly and leaves the terminator alone (header,
    tree-fold.js:41-55). So a fold that lies wholly inside the shadow keeps the same boundary.
    That is possible only for the `mov ss`/`mov sp` pair under IFEN_STI_MOVSS.
- **handler-effects ignores `global.set`**, so `sti`'s write to `$ifarm` is invisible to it.
  - It does not matter, because `sti` is never folded.
  - The design's "sti now writes a control global" is true and has no effect here.
- **Loop and call trees** go through `buildRegion`, so they decline (§2).

## 5. Everything that sets IF besides STI/POPF/IRET, and whether it is a candidate delivery instant

| where | what | eligible in the candidate? |
|---|---|---|
| dos-loop.js:1420-1424 | **host-serviced INT return.** The host performs the IRET in JS (`vm.set('flags', rd(4))`) and returns `'int'` with no rungs. | **No.** The pending IRQ waits for the next eligible boundary or stop. It is deterministic in every arm (the session services every stub), so it could become one in a later cut. |
| emit.js:1530-1535 | **IRETD into V86** through `$v86_from_monitor` (`exitwhy v86`), loading IF from the frame | No (`v86` is not in `ifenExit`) |
| emit.js:5425-5440, 5530-5540 | gate entry: interrupt gates clear IF, trap gates leave it | n/a (never sets IF to 1) |
| emit.js:1498 (iret), 1539 (iret32) | the VM's IRET | yes (`iret`) |
| emit.js:1033, 1057 | POPF/POPFD | yes (`popf`) |
| emit.js:1287 (sahf) | low byte only | n/a |
| emit.js:5003-5357 and others | `$flags_put` of arithmetic results. The word comes from `$flags_word`, so IF is preserved. | n/a |
| emit.js:6281 `set_flags` | host writes: serviceInterrupt, `raise`, PSP restore (dos.js:115) | n/a (host side) |

Toyvm does not model IOPL for STI/CLI/POPF (§1 of the design: the VM's own IF is what counts).

## 6. Where a delivery can land inside an SS-load or STI shadow TODAY (HEAD + stack)

A rung fires only at a handback. Under the schedule, the timer, GUS, retrace and keyboard rungs
fire only at a stop (`atStop`, dos-loop.js:1836); the Sound Blaster's forced line (`svec`,
2080-2083) fires at any handback with IF=1.

A handback lands exactly on the boundary right after STI, MOV SS or POP SS whenever that
instruction is immediately followed by a non-instruction handback:

1. **`jmp_syn` whose lookup misses** (compile.js:534 → GO_SYN cold arm `$jlook_syn` → `EXIT('edge')`).
   This happens when the next ip is a head this compile already holds but the jump table does
   not resolve: a dropped block, a µop-held head (uop-live), or a region head. It is an early
   handback, so only `svec` can deliver there under the schedule. **Under `--no-irq-schedule`
   every handback is a stop, so the timer can deliver there.**
2. **`end_cut`** at a volatile boundary or at maxWords (compile.js:515, 543): the same.
3. **TF single-step** (oneInsn, compile.js:666): every boundary is a handback.
   - If the 1-dispatch budget ends past the stop date, `atStop` holds and the timer rung fires
     right after STI or MOV SS.
   - Real hardware also suppresses the #DB trap after MOV SS; toyvm raises INT 1 there.
4. **µop-only**: an STI or SS-load site is a one-instruction fallback. Its `end` hands back to
   `drive`, which runs on, so it is not a session handback. Only an exhausted budget with `mid`
   false returns there. `mid` is true for `end`, so in practice drive continues.
5. **Region JIT**: stops are only at lowered edges (after a transfer), so it is never inside a
   shadow unless the transfer itself is the shadowed instruction's successor boundary. That is
   allowed.

The candidate removes cases 1 and 2 for **STI**: the follower is always inline, so there is no
`jmp_syn` or `end_cut` between STI and its follower. Case 3 for STI remains under TF; the host no
longer delivers on an armed `end`, but a stop's ordinary rungs can still fire there.

**SS loads outside an STI shadow are unchanged.** Cases 1-3 remain for MOV SS/POP SS and are
noted as a residual. The fix would be the same treatment (decode the SS load's follower inline),
but it needs its own failing case first.

## 7. State lists, generated artifacts

- **emit.js STATE** (emit.js:6019) drives the globals (`stateGlobals`) and the get/set accessors
  (`stateAccessors`, :6272). The candidate appends `irqpend` and `ifarm`.
  - trace-jit.js builds its own module from `stateGlobals()` (trace-jit.js:1523), so the
    globals exist there too.
  - region-live `carryState` copies all of STATE (region-live.js:750). Both values are 0 between
    slices.
- **trace-jit.js:1863** fingerprint exclusion list: add both. They are not guest state, like
  `irqwant`.
- **uop-harness.js:34-36 NOT_GUEST:** add both, and zero them where `irqwant` is zeroed (:69).
- **The handler table gains `jmp_ifen`** right after `jmp_syn`, so every later handler index
  shifts. Anything that persisted handler indices must be regenerated:
  - `docs/dos-corpus/live/toyvm-bundle.js` and `toyvm-jit-bundle.js` (bundle-browser.js:364-365);
  - the build's "toy-VM browser-bundle reproducibility" gate (CLAUDE.md) will fail until they are.
  - Table headroom: emit.js notes reg-spec takes the table to 2045/2048. One more handler is
    2046, which is OK but tight.
- **`EXIT_WHY.ifen = 11`.** WHY_NAME is derived from it (dos-loop.js:61); the uop-only `why`
  stats gain `ifen`.
- **compile.js `gsCharge`**: `jmp_ifen` charges 0, the same as jmp_syn. Otherwise the gspin route
  search would treat it as an unknown charge and could decline a collapse HEAD makes.

## 8. Findings that contradict or refine the design

1. **decode.js alone cannot defer `endsBlock`** (§1.1). The deferral has to live in compile.js's
   block loop. It also has to suppress four things there:
   - the wasm decoder (1.2 item 1);
   - jmp_syn (item 2);
   - the volatile cut (item 3);
   - extendThrough (item 5).
2. **A non-transfer follower needs a new transfer op** (`jmp_ifen`). No existing op is
   both step-neutral and `$ifarm`-aware.
3. **The region JIT does not inherit CONT** (§2). Its lowered edges, back edge and epilogue use
   their own tests, and `GO_RE` pattern-matches CONT's text. The candidate makes it decline.
4. **µop-only does not "exit to the interpreter" in the sense the design needs** (§3.2). Its
   drive loop runs on through `end`/`edge`/`ret` handbacks.
5. **HLT is not "already a handback" in every arm.**
   - In µop-only, HLT's one-instruction fallback ends in `end`, which drive treats as clean
     (uop-only.js:53, 276).
   - On the host side, HLT's `end` shares `EXIT_WHY.end` with `end_cut`, unimplemented ops and
     TF steps, so it cannot be told apart.
   - HLT (design (d)) is left out of the candidate.
6. **Reusing `$irqwant` for the timer would move Sound Blaster boundaries.**
   - `$irqwant` is the SB forced line. Setting it for the timer would make every new POPF/STI exit
     fire for SB too, which moves existing SB boundaries.
   - Separately, `(i32.and (global.get $irqwant) pred)` (emit.js:1506) is bitwise, so a non-0/1
     value is unsafe.
   - The candidate uses a separate 0/1 `$irqpend`.
7. **`$exitwhy` can be stale.**
   - `int_imm`'s fast path sets `exitwhy=int` and keeps running (emit.js:1487-1489).
   - µop-only drive runs on past exits.
   - So the host combines `exitwhy` with `$ifarm`, requires `left >= 0` and `!atStop`, and
     µop-only zeroes `exitwhy` when it continues.
8. **The CONT cost is as stated:** one `global.get` plus one `i32.or` per block transfer, inside
   `select`. The pattern also appears inside `$jlook_edge` and `GO_LOOKUP`. It is unmeasured.
