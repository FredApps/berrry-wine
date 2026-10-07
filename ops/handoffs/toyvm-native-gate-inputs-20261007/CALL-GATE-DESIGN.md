# Protected-mode call-gate design — source-only, 2026-10-07

No CPU edit or new execution. This is broader than treating GDT+48 as a different
base. The actual captured gate is typeC/DPL3 and targets nonconforming DPL0 code;
a return address and stack transition must be architecturally coherent.

## Architectural contract to implement

For protected non-VM86 CALL, classify the operand selector before altering the
stack. Validate table extent, gate type/presence and gate DPL against both CPL
and operand RPL. Validate the gate's target selector as present code, its type,
privilege and offset limit. Ignore the instruction's offset for a gate. A
nonconforming destination of lower numeric DPL changes CPL; conforming or
same-level code keeps CPL. Gate width controls return/parameter units, even
when caller and target default operand widths differ. A privilege change takes
the appropriate stack from the current TSS; validate its selector, privilege,
writability, presence and full frame capacity before mutation. Build the frame
with old SS and old SP/ESP, copied parameters in original order, then return CS
and IP/EIP. At final top-of-stack: return offset, return selector, parameters,
old stack offset, old stack selector. Same-level gates have only the return
pair. Parameter count is the gate's low5 bits. CALL preserves flags. Fault paths
must identify #GP/#NP/#TS/#SS and correct restart location, not continue through
an invalid gate. [Intel CALL contract](https://pdos.csail.mit.edu/6.828/2018/readings/i386/CALL.htm)

RETF validates return CS and detects an outer-level return from its RPL. It
must validate the saved outer SS, restore the outer stack, and release the
immediate byte count on both parameter copies when applicable. Return operand
size controls the frame pop, independently of SS.B. Segments no longer usable
at the outer privilege level are nulled; accessible data/code segments remain.
Failed validation must not leave a partly popped stack. No call-history flag
substitutes for inspecting the actual return frame. [Intel RET contract](https://pdos.csail.mit.edu/6.828/2018/readings/i386/RET.htm)

## Exact ToyVM integration seams

Pinned source is tools/toyvm/emit.js001b2408, not a promise about a later main.

- Four call handlers: call_far2484, call_far32 2534, call_far_m2627,
  call_far_m32 2669. Operands are already reread from actual instruction/memory
  bytes. Keep these reads once and their existing address-size/segment handling.
  Route decoded selector, operand offset, nextIP and instruction operand width
  into a shared transfer helper BEFORE any existing push. Real/VM86 behavior
  remains the current path. Never globally reinterpret a gate in $sset, because
  data-segment loads and RETF have different validity rules.
- Four RETF handlers2494/2499/2514/2519 need a shared validated return operation;
  current pop-before-validate sequence cannot support atomic failure handling.
- decode.js762–772 and1080–1083 carry nextIP but not an explicit faulting
  instruction IP for every far form. A correct fault path needs that operand
  or another proven instruction-start convention. $gip may name a block start,
  not this instruction. Updating handler arities/decoded word layout must be
  propagated to all consumers and tested, not hidden in one emitter patch.
- $descaddr4664 checks only the masked index against GDT limit, applies linmask,
  and also uses GDT limit for LDT. A checked full8-byte resolver with proper
  table choice/limit is needed for these operations. Current state keeps LDTR
  selector/base but not a separately cached limit; deriving from the actual
  GDT LDTR descriptor is a bounded option to review. Do not change permissive
  general $segbase as an incidental part of this task.
- $sset4563 refreshes cached base, CS.D and SS.B mask. Use it only at the commit
  point with validated code/stack selectors. Current get_sp is full ESP;
  stack addressing width comes from $spm. The gate's16/32-bit frame width is
  a separate input. Stage old-stack parameters before writing a possibly
  overlapping destination stack.
- $tr is stored by LTR2924. $v86_to_monitor5549 already resolves TR and reads
  32-bit TSS ESP0/SS0, but constructs a VM86 interrupt frame, not a call frame.
  Reuse only validated descriptor/stack primitives after review. Ring1/2 stack
  slots and16-bit TSS layouts need defined handling, not hardcoded ESP0.
- $fault5443 presently switches TSS stacks only for VM86. Its ordinary PM path
  lacks privilege-switch handling and ordinary error-code pushes; $errc is
  consumed only in the VM86 path. Thus merely calling $fault for new gate
  validation failures would not yet produce a correct general protected-mode
  exception. Treat this as an explicit prerequisite or a separately reviewed
  unsupported-case stop, never a fabricated successful fault delivery.
- Far JMP through a gate has different privilege rules and no call frame.
  Existing jmp_far* also use $sset directly. Do not accidentally run CALL
  semantics there; shared classification can be reviewed separately.

## Meaningful actual-instruction tests

Use the existing test/test-toyvm-far-pointer-loads.js convention: build a small
self-checking COM image, execute real decoded instructions via run-dos, record
numbered failure markers, and exit a distinctive success code. That existing
fixture covers real-mode far pointer loads, not call gates. Add a focused
private test first, then durable tier registration only with an approved patch.
Keep runtime bounded; separate fresh original/candidate processes, exact module
hashes and unchanged-source controls. No proprietary fixtures required.

1. Same-CPL type4 and typeC gates; direct and indirect CALL; contradictory
   instruction offset proves gate offset wins. Cover16-bit caller/typeC and
   32-bit caller/type4. Assert actual CS/base/IP and byte-exact return pair.
2. Ring3→0 typeC, distinct sentinel-filled stacks and nonzero ESP0; count0,
   count2, count31 parameters. Callee verifies full frame bytes and untouched
   surrounding bytes. RETF imm releases both copies and returns to the exact
   caller with registers/flags/stack restored. Include SS.B16 and B32 and
   target CS.D independent of gate width. Same-CPL count>0 must not copy args.
3. Conforming target and ring3→1 transition; GDT and LDT-backed target/stack.
   Explicit16-bit TSS case if supported; otherwise unsupported outcome must be
   deliberate and tested, not a false success or accidental host trap.
4. Invalid/null/out-of-limit/nonpresent gate, too-restrictive DPL/RPL, data
   target, target offset limit, bad TSS extent, wrong SS type/RPL/DPL/presence,
   old/new stack boundary and return-frame errors. Assert exact fault/error
   marker and no premature CS/SS/SP/frame mutation once exception delivery is
   actually supported. Original negative control must fail the real target or
   frame assertion, not missing helper/export/setup.
5. Existing ordinary far-call/return, real/VM86 pointer loads, PM timer-vector,
   IP-width and operand-patch regressions. Regenerate browser bundles only after
   source acceptance; keep JIT/trace lowering and machine-state transfer parity
   under their existing gates. No performance conclusion from diagnostics.

## Remaining live evidence and independent limitations

The queued reader captures actual TR/TSS prefix and preceding code. It cannot
retroactively prove an instruction boundary. If256 code bytes do not establish
the transfer unambiguously, add a separately reviewed handler record that uses
already-read operands (no repeated device reads). Paging is still absent and
MOV CR3 is still discarded in this baseline. A correct call-gate test neither
implements paging nor proves it unnecessary for Daggerfall. Native drive and
directory semantics, MSCDEX, protected DOS pointers and devices remain distinct.
