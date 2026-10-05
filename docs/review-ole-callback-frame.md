# Review P5-3: shared OLE guest callback frame builder

2026-09-19: the six `$ole_guest_callback_invoke1..6` helpers retain their
arity-specific signatures but delegate frame construction to one private
helper. That helper resolves the guest method before mutating anything,
computes the exact stack footprint, writes the return thunk and `this`,
writes only the supplied arguments, and sets ESP/EIP/steps once.

No shared scratch buffer or persistent frame state is introduced. Contexts
remain owned by their guest stack frames, and absent interfaces, vtables or
methods return zero without modifying the stack or CPU state. The count is
private and supplied only by the six constant-arity wrappers.

## Verification

- `test/test-ole-callback-frame.js` calls every original wrapper before the
  refactor and every refactored wrapper after it. All six arities pass exact
  frame contents, argument order, ESP/EIP/steps, adjacent memory guards and
  context preservation. NULL interface/vtable/method cases each pass with
  unchanged CPU state and guest memory.
- A negative in-memory mutation writing argument one even at arity one fails
  the context/guard comparison. This catches writing padding arguments above
  the callback frame, not just wrong callback return values.
- `test/test-ole-guest-callback.js`: 111/111 checks pass with real guest x86
  COM callbacks and continuation dispatch, including storage/clipboard
  ownership and lifetime cases.
- Full canonical/compat build and gates pass, with 239 nonoverlapping data
  segments. No census allowance changed.

Local evidence: `/private/tmp/wa-ole-frame-before.log`,
`wa-ole-frame-after.log`, `wa-ole-frame-negative.log`,
`wa-ole-frame-guest.log`, `wa-ole-frame-build.log`.
No new COM feature or performance improvement is claimed.
