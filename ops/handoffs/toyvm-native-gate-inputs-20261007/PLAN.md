# Bounded gate-input followup (source only)

Original CR3 emitter instrumentation is byte-identical to the validated earlier
private transform. No additional WAT globals/imports or behavior changes.
New reader uses existing pure mget_tr/get_ssb/mget_spm and actual register getters.
Each existing pre-step PM row records actual TR selector/8B descriptor, validated
present32-bit TSS prefix32B (including ESP0+4,SS0+8), old SS/fullESP/mask/base
and64B stack, plus actual gate4b and derived target descriptor. Code capture grows
32→256B; original read span cap stays256B. No wrap is invented for diagnostic
reads, and raw mapped bytes never imply architecture validity.

The goal is to disassemble the captured predecessor block5b:1204 and associate
its transfer with the next actual4b entry. This is NOT an instruction checkpoint.
If control flow remains ambiguous within captured bytes, stop at that limit;
do not claim an exact executed opcode. A future actual handler-only record must
not duplicate rd16/rd32 operand reads, which can have device side effects.

Daggerfall only, no repeated Arena query,3s guest/20s complete lifecycle,
32 distinct PM rows then cap,200KiB output head/tail+fullstreamSHA. Existing
supervisor group teardown/close drain and exact original file/source validation.
Original payload stays in place. New gate-inputs.test.js is pure JS and passed; receipt in pure-js-validation.json. No native runtime grant exists.

## Exact getter/source contract

Pinned vm.js:117 declares WIDE={'gip','sp'}; :124-126 resolves sp to the full
get_sp() >>>0, unlike other16-bit register aliases. Thus vm.get('sp') is full
ESP in this exact source; stackMask records the independent current SS width.
Pinned emit.js:6079 includes sp in STATE; stateAccessors at6327 emits get_sp.
The same function emits all six get_<seg>b exports including get_ssb. At6287
MACHINE_STATE includes tr and spm, and machineAccessors emits mget_tr/mget_spm;
preamble unconditionally includes both at6473-6474. get_gdtb/get_gdtl are
explicit at6456-6457. This is source-derived export proof tied to original
emit001b2408/privatef9e20f1c and previously executed module89d400ba, not a newly
executed module-export census. The new reader throws on missing getters; the
observer retains that error and the probe marks capture incomplete.

SS0 descriptor resolution here is GDT-only. If actual SS0 has TI=1, its raw
selector/TSS bytes remain captured but ss0Descriptor reports unsupported GDT
selector; that means this diagnostic cannot resolve it, NOT invalid guest
architecture. The next plan must resolve actual LDT state before judging it.
