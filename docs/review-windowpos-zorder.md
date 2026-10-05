# Mutable WINDOWPOS Z-order follow-through

2026-09-20: fixed `SetWindowPos` forwarding the original `hWndInsertAfter`
argument to the host after accepting a replacement from the guest's
`WM_WINDOWPOSCHANGING` callback. The final `WM_WINDOWPOSCHANGED` structure
already carried the replacement, so the notification and host disagreed.
The host now receives the same effective `insert_after` value.

Microsoft's [WM_WINDOWPOSCHANGING documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-windowposchanging)
permits changes to the requested Z-order and relevant flags during the
callback. This is a documented-contract regression, not a fresh native
Windows 98 capture or a claim that all positioning behavior is complete.

`node test/test-windowpos-changing.js` executes a real x86 window procedure
and records both notifications and host Z-order calls. It checks:

- Clearing `SWP_NOZORDER` and replacing TOP with BOTTOM reaches the host;
  the final notification reports that same insertion target.
- Setting `SWP_NOZORDER` suppresses the host change.
- `SWP_NOSENDCHANGING` preserves the original insertion target.
- Existing geometry mutation, protected NOACTIVATE, MoveWindow, deferred
  notifications, and DefWindowProc geometry-message checks remain intact.

Before the runtime fix the new test failed with host `after: 0` instead of
`after: 1` (`/private/tmp/wa-windowpos-zorder-before.log`).
The additional callback has its own code allocation to avoid conflating
this behavior with decoded-code invalidation.

Validation after the fix: WINDOWPOS mutation, Win16 insert-after conversion,
and Win32 deferred-position lifecycle tests all pass; `bash tools/build.sh`
passes all gates and builds both normal and compatibility artifacts. Logs:
`/private/tmp/wa-windowpos-zorder-{after,win16,defer,build}.log`.

Remaining scope: full Win16 WINDOWPOS/WM_MOVE notification fidelity, native
Win98 comparison, and broader child/owner/topmost Z-order semantics are not
established by this focused host-boundary test.

## Invalid targets and Win16 failure propagation

The next audit found that a null, unknown, or retired target bypassed the
notification allocation and still reached host geometry/Z-order calls before
returning success. SetWindowPos now rejects those targets before querying or
changing geometry, returning zero with ERROR_INVALID_WINDOW_HANDLE (1400).
The null check is explicit: `wnd_table_find(0)` means the first empty slot,
not a live desktop window.

The Pascal Win16 wrapper also used to overwrite the shared result with 1
and perform its own post-call Z-order work. It now returns immediately on
shared failure, preserving zero and the normal far-return/14-byte argument
cleanup without a Z-order update or size callback.

Both existing regressions now cover null, unknown, and retired targets.
The Win16 retired case retains an existing handle mapping while removing
the window, so a translatable stale handle is not mistaken for a live one.
Each test failed with `1 !== 0` before the fixes and passes afterward;
host geometry and Z-order logs must both remain empty. The Win32 test also
requires error 1400 and no guest notification. Evidence:
`/private/tmp/wa-windowpos-invalid-{before,after}.log` and
`/private/tmp/wa-windowpos-invalid16-{before,after}.log`.

The [SetWindowPos contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
requires a window handle and reports failures as zero; modern documentation
is not a substitute for the still-open native Win98 notification comparison.

Also passing after this change: actual WINDOWPOSCHANGED resize delivery,
deferred visibility/paint state, Win16 deferred transactions (including real
far callbacks and nested/busy commits), and Rodent/Rattler gameplay input.
Full normal/compatibility builds pass. Logs:
`/private/tmp/wa-windowpos-invalid-{changed,visible,defer16,vb,build}.log`.
