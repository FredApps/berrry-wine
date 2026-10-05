# Rejected OLE operations must not mutate data — 2026-09-22

While reviewing the shared structured-storage handlers, four front doors used
WAT `select` to choose between a mutating call and a high-word error:

```
select(resize_or_lock(low_words), error, high_words_are_zero)
```

`select` evaluates its value operands before choosing the result. Thus the
caller received an error **after** a truncated 32-bit operation had succeeded:
ILockBytes/IStream SetSize could shrink, clear or reallocate the backing data;
IStream LockRegion could insert a lock; UnlockRegion could remove a real lock
whose low words matched the rejected 64-bit range.

All four now use result-valued `if`, invoking the existing shared operation
only when the high words are zero. The shared operations, accepted-input
semantics, API metadata and stack cleanup are unchanged. This is a correctness
fix discovered during the review, not a duplicate-count reduction.

## Evidence

`test/test-ole-rejected-mutations.js` failed before the change in all 44 cases:
36 SetSize combinations and eight LockRegion/UnlockRegion combinations. The
same 44 cases pass after the change. Calls use real name lookup and generated
dispatch, including the sixth stack argument for lock flags.

- Real ILockBytes, private stream clones and HGLOBAL-backed streams exercise
  high words 1, 2, 0x80000000 and 0xffffffff with low sizes 0, 4 and 128.
  Failed calls preserve complete object metadata, backing pointer/capacity,
  backing bytes, clone metadata and cursor state. A subsequent valid truncate
  checks that the accepted path still runs and does not move the cursor.
- Invalid lock/unlock offsets and lengths preserve both the lock-list head
  and live entry bytes. Clone lock attempts verify exclusion remains after
  rejected unlocks, and no spurious lock exists after rejected locks.
- Every call checks HRESULT, exact ESP advancement and a caller-stack guard.
- Existing OLE storage and compound-file suites pass 79/79 and 22/22 checks.
  Fragment, handler ESP,
  generated epilogue, quiet-inventory, exact-duplicate and test-tier gates pass.
  Quiet inventory remains 248 manual + 22 metadata; duplication remains
  131 groups / 509 members.

## Contract and remaining work

Microsoft documents full-width `ULARGE_INTEGER` sizes for
[IStream SetSize](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-istream-setsize)
and [ILockBytes SetSize](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ilockbytes-setsize),
and exact full-width ranges for matching
[LockRegion/UnlockRegion](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-istream-lockregion).
Rejecting the full-width request while applying only its low words is not an
implementation of that request.

The existing rejection HRESULT `0x80030019` (STG_E_SEEKERROR) is preserved,
**not** certified as native Win98 behavior. Microsoft's IStream SetSize docs
allow STG_E_INVALIDFUNCTION for unsupported high words. A native probe is
still needed to settle exact failure codes by backing implementation; the
current lock support also needs that comparison (Microsoft notes compound-file
streams do not support region locking). No >4GB storage support, full native
OLE conformance, browser behavior, performance or release-build claim is made.

Next: native rejection/lock-support evidence, then audit other side-effecting
`select` operands. Pure selection and unconditional safe reads should not be
blanket-rewritten merely because a call occurs in an operand.
