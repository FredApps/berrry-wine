# MIG-SAM-TIMER implementation handoff

Worker `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`, 2026-10-02 UTC.
Implementation and six focused suites **PASS**. No canonical build, game run,
commit, remote process, or retained-session command. Local CPU claim released
after the final waveOut suite; only handoff writing followed.

New narrow hunks in four files:

- `src/09a-handlers3-sync.wat`: persistent callback TLS vector with its own
  production registry node, separate SEH head and LastError; save/restore the
  interrupted vector/node, TIB[0]/TIB[0x2c], LastError and Delphi exception-search
  scratch. FS base never changes. Callback exception scratch starts empty.
- `src/13-exports.wat`: prepare context before consuming the due timer or
  changing a parked wait. Failed allocation preserves caller state, including
  LastError, and leaves a due one-shot available. At terminal run exit restore
  context identity without restoring the interrupted EIP or reviving main.
- `src/09a5-handlers-window.wat`: the internal DispatchMessage MM_TIMER route
  enters the same context; nested delivery is refused before overwriting the
  outstanding frame. A refused internal message returns0 without a callback.
  This pseudo-message has already been dequeued: allocation failure or nested
  refusal drops that delivery. Due-slot/one-shot retry preservation applies
  **only to asynchronous fire_mm_timer**, not DispatchMessage. No message
  requeue contract was introduced by this bounded slice.
- `src/09b-dispatch.wat`: CACA000A leaves the timer context before restoring
  caller registers. Active-context guard preserves the waveOut path, which
  shares that continuation but never enters a timer TLS context.

Callback vector/node lifetime matches existing process-lifetime thread TLS.
Keeping both vectors registered allows late DLL templates and TlsFree to
reach an inactive callback vector. Partial initialization retains registered
storage for a later retry. This is still a borrowed execution context, not a
new Windows system thread; no thread-ID, PE TLS callback, unload lifecycle,
fault/REP, launcher or input expansion was attempted.

Added `test/test-mm-timer-context.js`. Its emitted x86 probe is decoded on main,
then reused from async and DispatchMessage callbacks, then main again. Tests
assert stable FS base, correct TIB indirection, independent initialized EXE TLS
plus zero fill, persistent dynamic/static callback values, late relocated DLL
templates, separate registry nodes, inactive-vector TlsFree clearing, vector /
node / template allocation failures, unchanged failed-delivery LastError and
pending one-shot, nested refusal, handled software exception completion,
main exception scratch restoration, waveOut continuation and terminal cleanup.
Heap failure injection exists only in the fixture's compile transform; no
production allocation behavior is replaced. `tools/test-tiers.js` automatically
classifies this filename as UNIT, so no membership-file edit was needed.

All tests ran serially after coordinator CPU grant, exit0:

1. `node test/test-mm-timer-context.js`
2. `node test/test-mm-timer-callback.js`
3. `node test/test-tls-lifetime.js` —108 native observations and EXE/DLL cases
4. `node test/test-tls-shared-workers.js` —four Workers,160 reservations
5. `node test/test-seh-continue-execution.js`
6. `node test/test-waveout-callback-function-wasm.js`

JS syntax, owned diff whitespace, WAT logical-AND, tier completeness and all
four modified WAT fragment paren/label checks also pass. No test failed during
this implementation turn. Tests compile source with their fixture exports;
their exact source/test hashes are recorded, not a canonical WASM build claim.

Evidence: `scratch/mig-sam-timer-20261002/` contains `before/` full copies and
pre-existing dirty patch/provenance, `after/` final owned files,
`timer-only.patch`, `source-identity.json`, `test-identity.json`, six logs and
`validation.json`. Source hashes were unchanged across the suite sequence.
The narrow patch is additions only relative to the before snapshot; preserve
all earlier TLS/SEH/foreign hunks when reviewing or later staging these files.
The new test is separately preserved in `after/test/`.

Next bounded validation, after coordinator review: create a private module
from the current source while retaining only the remaining fault/REP diagnostic
transforms. Remove **all** timer transforms from the old preserved builder,
including its late stable-FS replacements and DispatchMessage/CACA000A hooks;
otherwise two contexts will be mixed. Freeze the source identity, compile to a
unique private output, and replay through87000/90000 using the now-reviewed
intro route. The expected87000 transition may be near-black;90000 showed the
bright GODGAMES logo in both previous preserved modules. No such new module or
game replay was built/launched in this slice. Production fault/restart and
normal input/gameplay verification remain outstanding.

Exact builder edit: copy the preserved
`scratch/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd/serious-tls-integrated-build.js`
to a new uniquely named scratch builder. Delete its entire first
`if (file === '13-exports.wat')` block that inserts ss_timer globals/helpers
and fire_mm_timer entry; delete its `09b-dispatch.wat` block adding
ss_timer_leave; delete its second `13-exports.wat` block rewriting FS swaps
into TIB swaps; delete the final `09a5-handlers-window.wat` block adding
ss_timer_enter. Preserve both `03-registers.wat`, both `11-seh.wat`, both
`05b-string-ops.wat`, `05-alu.wat` and `07-decoder.wat` transform blocks
unchanged. Replace only the final output pathname with a unique private
scratch WASM path. Assert no ss_timer symbols or timer-targeted transform
blocks remain. Inputs are the current src/main.watx closure plus its ordinary
compiler, with this handoff's owned source hashes checked first; output is a
new hash, never the preserved363d artifact or build/wine-assembly.wasm.
