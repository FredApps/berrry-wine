# Silent-handler inventory history

The build gate in `tools/check-silent-stubs.js` rejects additions or mutations
to straight-line handlers that cannot delegate work, publish output, branch, or
fail loudly. Its executable source intentionally contains only the classifier,
the current count/hash pin, and enforcement. This file preserves the historical
count changes and their behavior rationale without making every explanation a
change to gate code.

When an existing quiet handler gains real behavior, update the two-value pin in
the same commit. Append a dated explanation here when it adds useful context.

This is a ratchet, not approval of the old entries. Any addition or mutation
changes the digest and stops the build; deleting/fixing an entry deliberately
lowers the count and updates the digest after review.

2026-08-31: 506 -> 505. Commit 34b4f08f ("Fix Win98 installer chain
launches") gave handle_CreateProcessA a real implementation, so it left the
quiet inventory. Ratchet only; nothing was added.

2026-08-31: 505 -> 508. MSVCRT startup helpers _lock, _unlock, and
__lconv_init are documented compatibility no-ops for single-threaded CRT
initialization paths.

2026-09-01: 508 -> 507. handle_IDirectDraw_WaitForVerticalBlank was the
textbook silent success -- it set EAX=0 and returned, so a game that used
the display as its clock was told the retrace had already happened. It now
parks on a real vblank (yield_reason 13). Ratchet only; nothing was added.

2026-09-01: 507 -> 525. Minimal no-audio BASS compatibility handlers let
shareware games bundled with bass.dll continue to gameplay.

2026-09-01: 525 -> 526. __mb_cur_max is a documented constant for the
emulator's single-byte ANSI CRT environment.

2026-09-01: 526 -> 527. _cexit acknowledges CRT cleanup without process
termination; returning terminator callbacks need a separate future path.

2026-09-01: 527 -> 528. _getdrive is a documented constant in the default
single-drive C: process environment.

2026-09-01: 528 -> 529. _setmode acknowledges text/binary mode changes and
returns the previous text mode because stdio streams are not distinguished.

2026-09-01: 529 -> 530. keybd_event is a legacy input-synthesis probe shim;
browser-side input injection remains host-owned.

2026-09-01: 530 -> 531. joyGetPosEx mirrors joyGetPos for a no-joystick
Win98 environment so startup probes can keep keyboard/mouse input.

2026-09-02: 531 -> 529. Legacy SetWindowsHookA/W now installs the same
process-local keyboard/CBT callbacks as the Ex path, and UnhookWindowsHook
removes only a matching installed procedure instead of always succeeding.

2026-09-02: 529 -> 516. DirectPlay's bounded local session now retains
player/group identities, names, flags and memberships; its lifecycle and
four entity enumerators update or traverse that state instead of returning
success without work.

2026-09-02: 516 -> 514. SetPlayerData and SetGroupData now retain copied
local/remote application data in the DirectPlay entity repository; their
matching getters implement the Win98 size-query and readback contract.

2026-09-02: 514 -> 512. DirectPlayLobby EnumAddress now walks bounded
compound-address chunks through a cancellation-aware callback, while
EnumAddressTypes reports the local TCP/IP provider's required DPAID_INet.

2026-09-02: 512 -> 511. EnumLocalApplications validates its required
callback and reserved flags, then truthfully enumerates the browser Win98
machine's empty set of registered lobby-aware applications.

2026-09-02: 511 -> 502. Win32 DDEML now owns instance, copied HSZ,
registered-service, conversation and data-object state; invalid, stale and
cross-instance handles fail instead of fixed values succeeding silently.

2026-09-02: 502 -> 500. Begin/EndDeferWindowPos now allocate, validate,
consume and free real bounded HDWP transactions; queued geometry remains
unchanged until End applies it through the SetWindowPos behavior path.

2026-09-02: 500 -> 497. OpenClipboard/CloseClipboard now own an exclusive
USER transaction, and GetClipboardOwner reports ownership assigned by
EmptyClipboard instead of three fixed success/null answers.

2026-09-02: 497 -> 494. GetSubMenu now resolves real popup ownership,
ModifyMenu mutates dynamic items, and DrawMenuBar validates and redraws the
target window's non-client menu chrome instead of fixed success/handles.

2026-09-02: 494 -> 493. FindWindowA now searches the live top-level USER
tree by optional class atom/name and title instead of always returning NULL.

2026-09-02: 493 -> 491. SetPriorityClass/GetPriorityClass now validate the
emulated process handle and retain one shared Win98 priority class.

2026-09-02: 491 -> 489. GetThreadPriority/SetThreadPriority now validate
thread identity and retain the Win98 relative priority on the thread object.

2026-09-02: 489 -> 488. SetErrorMode now atomically replaces and returns the
shared Win98 x86 process error mode instead of always returning zero.

2026-09-02: 488 -> 483. COM/OLE initialization now owns per-thread apartment
model and nesting state; the dead duplicate OleInitialize body is gone.

2026-09-02: 483 -> 482. TranslateMessage now distinguishes the four
virtual-key messages from unrelated MSGs instead of always returning TRUE.

2026-09-02: 482 -> 480. SetThreadLocale and GetThreadLocale now retain real
per-thread LCID state and carry it into newly created threads.

2026-09-02: 480 -> 479. BringWindowToTop now changes sibling/top-level
z-order and activation state instead of reporting unconditional success.

2026-09-02: 479 -> 477. SetActiveWindow/GetActiveWindow now retain this
thread queue's active top-level and deliver real activation transitions.

2026-09-02: 477 -> 476. UnregisterClassA/W now remove the matching owned
class only after its last window is gone instead of always returning TRUE.

2026-09-02: 476 -> 473. Direct3D Device 1/2/3 GetStats now initializes all
five D3DSTATS counters and rejects a null output buffer.

2026-09-02: 473 -> 472. ImageList_Destroy now validates and invalidates its
handle and releases both the image-list record and retained icon array.

2026-09-02: 472 -> 471. CopyIcon now creates an independently owned copy of
bitmap-backed, resource-backed, and opaque system icon handles.

2026-09-02: 471 -> 470. CopyImage now owns and resamples bitmap/icon/cursor
images, including RETURNORG/DELETEORG, monochrome, and DIB-section requests.

2026-09-03: 470 -> 469. SHFileOperationA now delegates copy, move, rename,
wildcard, multi-destination, and recursive delete work to the shared VFS.

2026-09-03: 469 -> 468. FlushFileBuffers now validates a live writable VFS
file handle and reports access/handle errors instead of unconditional TRUE.

2026-09-03: 468 -> 469. Video for Windows added DrawDibOpen/Close (+2), while
GetLastActivePopup left the quiet inventory by retaining and validating
per-owner activation history (-1). The inventory records both changes.

2026-09-03: 469 -> 467. DrawDibOpen/Close now own, validate, invalidate and
free distinct opaque drawing contexts instead of returning constant success.

2026-09-03: 467 -> 466. GetLogicalDrives now queries the browser VFS's live
assignment mask instead of reporting a fixed C:/D: constant.

2026-09-03: 466 -> 463. SetFileApisToOEM/ANSI now propagate their process
code-page choice to Kernel32 filenames, and AreFileApisANSI reads it back
from the same process-shared VFS state across guest thread instances.

2026-09-03: 463 -> 462. DisableThreadLibraryCalls now validates loaded DLLs
and suppresses their future thread attach/detach notifications.

2026-09-03: 462 -> 461. WinExec now delegates the real command line and
nCmdShow to the browser child-launch path and returns its success/error code.

2026-09-03: 461 -> 460. GetWindowRgn now copies the window's retained USER
region into the caller's HRGN and returns its actual region complexity.

2026-09-03: 460 -> 459. FreeConsole now tears down the process console
window, buffers, input queue, aliases, and attachment state.

2026-09-03: 459 -> 458. SetConsoleCtrlHandler now owns a process handler
chain and delivers processed Ctrl+C/Ctrl+Break events through guest callbacks.

2026-09-03: 458 -> 457. EnableScrollBar now retains per-window arrow state,
paints disabled arrows, and suppresses their input instead of always TRUE.

2026-09-03: 457 -> 456. OpenIcon now sends WM_QUERYOPEN and restores the
guest and browser window state instead of returning unconditional success.

2026-09-03: 456 -> 453. SetCapture/GetCapture/ReleaseCapture now validate
thread ownership and deliver synchronous WM_CAPTURECHANGED transitions.

2026-09-03: 453 -> 452. GetMapMode now reads canonical per-DC state.

2026-09-03: 452 -> 450. GetStockObject validates the Win98 selector set;
GetNearestColor now rejects invalid DCs instead of silently succeeding.

2026-09-03: 450 -> 449. GetTextCharset now reports selected font state.

2026-09-03: 449 -> 448. DestroyAcceleratorTable now validates repository
handles and releases only live tables instead of always returning success.

2026-09-03: 448 -> 447. SHBrowseForFolderA now runs a classic modal shell
tree and returns the selected PIDL instead of silently reporting Cancel.

2026-09-03: 447 -> 446. Shell_NotifyIconA now owns browser notification-
area add/modify/delete state and delivers Win98 mouse callback messages.

2026-09-04: 443 -> 442. GetClipboardSequenceNumber now reads the shared
window-station serial advanced by successful clipboard mutations.

2026-09-04: 442 -> 441. SetFileSecurityW now reports the Win98
ERROR_CALL_NOT_IMPLEMENTED result instead of claiming an ACL was persisted.

2026-09-04: 441 -> 439. ExtractIconA and ExtractIconExA now enumerate and
materialize caller-owned PE/NE/ICO icons instead of returning fake success.

2026-09-04: 439 -> 438. GetForegroundWindow now queries renderer-wide
top-level z-order instead of returning this process's main HWND.

2026-09-05: 438 -> 437. The Win98 Shell32 ArrangeWindows ordinal now tiles
eligible renderer windows instead of returning an unconditional zero.

2026-09-06: 437 -> 435. Direct3D Device2/Device3 DeleteViewport now validate
ownership, clear current selection, and release attachment references.

2026-09-06: 435 -> 432. Direct3D Device 1/2/3 NextViewport now walks each
device's retained Win9x viewport list, returns AddRef'd HEAD/TAIL/NEXT
interfaces, and distinguishes invalid input, empty lists, and list end.

2026-09-10: 370 -> 369. mixerMessage now enforces the documented
device-id-only, MXDM_USER-or-higher contract and reports unsupported private
driver messages instead of claiming every driver-specific request succeeded.

2026-09-10: 369 -> 367. DPA_Destroy and DSA_Destroy now validate opaque live
handles, retire them, and return both their backing arrays and handle records
to the process heap instead of claiming success while leaking every array.

2026-09-10: 367 -> 365. Comctl32_Free and Comctl32_GetSize now operate on
validated live allocations instead of returning unconditional TRUE and 256;
the same tracked extent also makes ReAlloc preserve only owned bytes, retire
moved storage, and fail without destroying the original allocation.

2026-09-10: 365 -> 364. MenuHelp now uses its real seven-argument stdcall ABI,
resolves command and popup help-string resources, and drives the status bar's
separate Win98 simple pane instead of silently doing nothing.

2026-09-10: 364 -> 363. ShowHideMenuCtl now parses its documented selector
pairs, toggles the corresponding child or whole menu, synchronizes the menu
check, and fails for absent mappings or controls instead of always returning
TRUE.

2026-09-10: 405 -> 404. IDirectPlay3 Receive now reads its object's received
message queue, negotiates buffer size, filters sender/recipient, and supports
peek or consumption instead of unconditionally reporting no messages.
The reviewed inventory diff removes only this handler; no entries were added
or otherwise changed. Message production and DP4 activation remain separate.

2026-09-10: 404 -> 403. IDirectPlay3 Send now copies messages into local
recipient queues and signals their events, validates sender ownership and
unsupported modes, and rolls back partial multicast allocation failure.
The reviewed inventory diff removes only Send, with no added or modified
quiet entries. Network transport and asynchronous sending are not implemented.

2026-09-10: 356 -> 353. MonitorFromPoint, MonitorFromRect, and
MonitorFromWindow now test the one browser monitor's actual rectangle and
honor MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, and
MONITOR_DEFAULTTONEAREST instead of always returning the primary handle.
The same slice validates GetMonitorInfoA and makes its work area agree with
SPI_GETWORKAREA and the browser desktop's existing 28-pixel Win98 taskbar.

2026-09-11: 353 -> 348. DirectInput device Acquire, Unacquire,
SetDataFormat, SetCooperativeLevel, and Poll now follow the documented device
lifecycle instead of returning unconditional success. The device retains its
standard keyboard or mouse data format and cooperative-level HWND/flags;
acquisition is non-reference-counted, data access requires acquisition, and
invalid formats, windows, flag pairs, and acquired format changes return their
documented HRESULTs. The browser still exposes only the system keyboard and
mouse and does not yet model acquisition competition or automatic foreground
loss.

2026-09-11: 348 -> 346. RegisterDragDrop now validates a live process window,
rejects duplicate registrations, and retains one IDropTarget reference per
window. RevokeDragDrop distinguishes invalid and unregistered windows, unlinks
the exact registration, and releases its retained target. DLL-private targets
cross the existing suspended guest COM callback bridge for AddRef/Release;
emulator-local interfaces use the synchronous path. Browser drop events are not
yet converted into IDataObject/IDropTarget calls.

2026-09-11: 346 -> 345. CoLockObjectExternal now implements its documented
strong-reference lifetime: every lock owns one IUnknown AddRef and every
balanced unlock performs one Release. Repeated locks remain independently
counted, null and malformed interfaces fail before mutation, and an unbalanced
unlock returns E_UNEXPECTED. DLL-private implementations use the suspended
guest callback bridge; emulator-local objects complete synchronously. The
fLastUnlockReleases proxy-disconnection distinction is not observable because
the runtime does not expose out-of-process marshaled connections.

2026-09-11: 345 -> 344. CoSetState now retains the replacement thread-state
IUnknown before releasing the former object, while CoGetState returns an
independently AddRefed pointer. Both paths preserve the same ownership rules
for emulator-local and DLL-private guest implementations.

2026-09-11: 344 -> 343. SetThreadAffinityMask now validates pseudo and durable
thread handles through the existing process thread authority and accepts only
bit zero, the sole processor in the browser Win98 machine. Empty and
out-of-process masks fail with ERROR_INVALID_PARAMETER instead of returning a
fabricated previous mask. GetProcessAffinityMask likewise rejects process
handles outside the one modeled guest process before publishing its 0x1 masks.

2026-09-11: 343 -> 342. IDirectDrawClipper::SetHWnd now retains the validated
window associated with each clipper object, and GetHWnd returns that exact
association instead of fabricating the process main window. Reserved flags,
invalid windows and null output pointers fail without changing retained state.
Generating and consuming the window's changing visible clip region remains a
separate DirectDraw task.

2026-09-11: 342 -> 340. IDirectDrawSurface::SetClipper now owns one COM
reference to its attached clipper, replaces or detaches it without leaks, and
automatically releases it with the surface. GetClipper returns an independently
AddRefed interface and reports a missing attachment. Windowed presentation now
uses the HWND retained by that clipper instead of assuming the cooperative
window; arbitrary SetClipList regions and occlusion snapshots remain separate.

2026-09-11: 340 -> 338. IDirectDrawClipper::SetClipList now validates and owns
a canonical RGNDATA copy, supports deletion and HWND/list exclusivity, and
drives actual clipped Blt copies, stretches, color keys, and fills without
slowing the no-list path. GetClipList implements size negotiation, bounded
copies, optional rectangle intersection, and live HWND client-region snapshots;
IsClipListChanged detects and latches window geometry changes until that list is
copied. Final Release frees retained region storage, and BltFast now rejects any
attached clipper as documented. Browser composition supplies HWND occlusion;
explicit RGNDATA rectangles are enforced in the DirectDraw framebuffer.

2026-09-11: 338 -> 336. IDirectSound::SetCooperativeLevel now validates the
live top-level application HWND and one exact Win98 DSSCL value, retains that
device state, and propagates later level changes to its existing buffers.
Compact requires PRIORITY or stronger instead of always succeeding. Primary
buffer identity now lives in immutable creation state rather than colliding
with DSBSTATUS_PLAYING; primary SetFormat requires PRIORITY, rejects secondary
buffers, validates PCM structure fields, and observes WRITEPRIMARY's stopped-
buffer rule. The browser has no fragmented hardware sound heap, so a permitted
Compact remains a successful no-op after its native privilege check.

2026-09-11: 336 -> 335. IDirectSoundBuffer::SetCurrentPosition now owns a
per-secondary-buffer play-cursor origin instead of returning success without
moving anything. Stopped buffers retain the byte used by their next Play;
playing buffers immediately restart the browser snapshot at that byte; Stop
freezes the live cursor; and GetCurrentPosition rebases the host-relative
cursor onto the retained DirectSound position. Primary buffers and offsets
outside the backing store fail rather than corrupting cursor state.

2026-09-11: 335 -> 334. IsBadCodePtr now follows its documented read-access
contract through the same mapped-range probe as IsBadReadPtr instead of
accepting every non-NULL address. The shared probe walks every crossed page,
honors sparse VirtualAlloc PAGE_NOACCESS, PAGE_GUARD, read-only, and writable
metadata, and fixes zero-length NULL ranges. IsBadStringPtrA/W now scan through
the first NUL or caller maximum without crashing, while the write probe rejects
read-only sparse pages. These cold API checks do not add permission branches to
the emulator's hot guest load/store path.

2026-09-11: 334 -> 333. CallNextHookEx now resumes the next live procedure in
the active WH_KEYBOARD/WH_CBT chain and returns its exact LRESULT. Hook installs
prepend distinct heap-backed handles, while legacy and Ex unhook operations
unlink only the named procedure and defer storage retirement across callbacks.

2026-09-11: 333 -> 333. CloseServiceHandle no longer treats every fabricated
nonzero value as a valid service handle. This Win98 personality cannot produce
an SCM or service handle, so both NULL and nonzero inputs now fail with
ERROR_INVALID_HANDLE. The audit count is unchanged because it intentionally
tracks deterministic quiet failures as well as quiet successes; its identity
hash changed with the corrected contract.

2026-09-11: 333 -> 332. GetProcessVersion now accepts only PID zero or the
runtime's one published process ID, rejects invented process IDs, and reads the
major/minor subsystem version stamped in the mapped executable's PE header. It
no longer returns the Win98 GetVersion encoding for every possible PID.

2026-09-11: 332 -> 332. ImmReleaseContext now agrees with the explicit no-IME
machine model: because ImmGetContext cannot issue a HIMC, neither NULL nor a
fabricated numeric handle can be released successfully. The audit count is
unchanged because the corrected deterministic failure remains a quiet handler.

2026-09-11: 332 -> 331. keybd_event now synchronously enqueues real system
keyboard input instead of returning without an event. Synthesized keys retain
the caller's scan code, extended/up flags, extra-info value, focused-window
target, and an event-time keyboard snapshot; GetMessage/PeekMessage therefore
apply the existing thread routing, WM_HOTKEY matching, and WH_KEYBOARD chain.
Alt and F10 select WM_SYSKEYDOWN/UP, and lParam carries context, previous-state,
and transition bits with the same queue ordering used by browser input.

2026-09-11: 331 -> 330. OpenSemaphoreA now resolves named semaphores created
through either CreateSemaphoreA or CreateSemaphoreW instead of always reporting
not found. Duplicate creation returns the same counted object, ignores the new
initial/maximum values, and reports ERROR_ALREADY_EXISTS; opens and creates own
references until the last CloseHandle destroys the name. Events, mutexes, and
semaphores now also share one case-sensitive process namespace, so a cross-type
name collision fails with ERROR_INVALID_HANDLE instead of creating two objects.

2026-09-14: 330 -> 290 cumulative audit. The executable pin had not followed
the mainline implementation stream since September 11, leaving every clean
build red even though the inventory moved downward. The reviewed delta covers
the intervening stateful USER/GDI/DirectX, console, locale, shell, heap, token,
security, filesystem, and compatibility work; the ratchet is banked at the
clean integrated tree instead of blessing any new unconditional success.

2026-09-14: 290 -> 289. OutputDebugStringA now sends its bounded ANSI payload
to the browser/CLI debugger sink. NULL remains an optional no-op, and an
inaccessible guest range cannot turn diagnostic output into an emulator crash.

2026-09-14: 289 -> 288. CommDlgExtendedError now reports retained COMDLG32
failure state instead of an unconditional zero. Common-dialog entry points
validate their complete Win98 caller structures before reserving a window,
entering modal state, allocating printer objects, or writing caller memory;
documented size, Find/Replace-buffer, font-range, and default-printer failures
remain distinguishable from an ordinary Cancel.

2026-09-15: 273 -> 272 manual handlers; 20 -> 21 explicit metadata stubs.
SetMessageQueue's constant TRUE is the documented Win32 compatibility contract,
not missing behavior: the obsolete call does nothing because USER grows a
thread's queue as necessary. The hand-written body therefore moved to explicit
generated stub metadata. Same-thread and cross-Worker producers now serialize
into one process-shared FIFO per Win32 thread, with a 64-message allocation-free
ring and heap-backed overflow across all sixteen execution slots. Filtered
retrieval, destruction purge, modal dispatch, wake predicates, slot reuse and
forced thread exit all address that same queue, so authentic QBob's
SetMessageQueue(96) cannot conceal an emulator-only ceiling or split-order bug.

2026-09-21: 253 -> 252 manual handlers; metadata remains 22. `_onexit`
previously returned its argument without registering anything. It now delegates
to the existing `crt_atexit_register` registry and returns the callback pointer
only on success, NULL on failure, preserving cdecl caller cleanup. This follows
Microsoft's [_onexit contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/onexit-onexit-m?view=msvc-170).
The existing termination dispatcher ignores callback return values and drains
the mixed atexit/_onexit registry in LIFO order before host termination.

`test/test-diablo-runtime-apis.js` failed before the fix because registration
count remained zero. It now covers NULL rejection, successful pointer return,
registry-capacity failure, cdecl stack delta, mixed LIFO dispatch and delayed
host exit. The capacity failure uses test-only registry globals to reach the
bounded-growth rejection; it is not a heap-exhaustion test. Callback dispatch
targets are inspected by the harness, not executed guest callback bodies.
The focused test, silent-handler pin and handler-ESP gate pass.

This is the process termination registry, not completion of DLL-local
`__dllonexit` registration/unload dispatch or `_cexit`'s returning cleanup path.
Those remain open. The quiet-handler census also includes valid state queries
(for example OleIsCurrentClipboard already compares the actual non-null owner),
so its total must not be described as that many proven unconditional-success
bugs. No classifier relaxation or arbitrary exclusion was used for this drop.

2026-09-21: 252 -> 251 manual handlers; metadata remains 22. `__dllonexit`
now appends to the caller's malloc-family callback table, updates both pointers
after successful reallocation, and returns the callback pointer or NULL. Tables
are independent of each other and of the process-wide atexit queue, following
Microsoft's [__dllonexit contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/dllonexit?view=msvc-170).
The caller's DLL CRT still owns reverse traversal and freeing at detach; this
change does not implement or verify a DLL-unload callback dispatcher.

The runtime regression first failed because 64 successful calls left the table
NULL. It now checks 64 registrations across reallocations, preserved order,
independent tables, no process registrations, cdecl cleanup, and unchanged
table contents/pointers on rejection. A synthetic oversized span reaches the
allocator's size refusal through heap_realloc; this is not a genuine exhausted
heap test. Null arguments and reversed/misaligned spans are defensive handling,
not behavior established by a Win98 differential. No callback bodies execute
in these table tests. `_cexit` returning cleanup remains open.
The focused runtime test, silent-handler pin and handler-ESP gate pass; no
full-build, browser, or native Win98 differential claim is made for this change.

2026-09-21: 251 -> 250 manual handlers; metadata remains 22. `_cexit` now
drains the process callback registry and returns to its caller without host
termination. Normal `exit` and returning cleanup share one LIFO pop helper.
The original return address stays on the guest stack, so nested cleanup cannot
overwrite a singleton saved return address. A dedicated CACA0038 continuation
resumes returning cleanup after each callback.

The focused runtime test executes real x86 code through public `_cexit` and
`_onexit` API thunks. It checks nested LIFO execution, continuation into the
original caller, exact stack restoration, absence of host exit, repeated empty
cleanup, registration after cleanup, and registration from inside a callback.
The public normal `exit(7)` path also executes a real callback and reports status
7 without resuming its caller. Existing dispatcher-target checks remain. The ESP
gate recognizes only the specific returning helper as delegating cleanup;
it does not exempt arbitrary CRT handlers.

This is **partial `_cexit` coverage**, not complete CRT termination. Microsoft's
[_cexit contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/cexit-c-exit?view=msvc-170)
also requires stream flushing/closure. Current FILE pointers are unbuffered VFS
handles and there is no open-stream registry; adding that lifecycle, then closing
streams after callbacks, remains open for both normal and returning cleanup.
DLL-unload execution and concurrent CRT termination are not verified here.
The runtime regression, quiet-handler pin and ESP gate pass. No full-build or
browser result is claimed for this callback change.

2026-09-21: CRT stream cleanup now follows the callback phase for both `exit`
and `_cexit`. A process-shared, locked ownership list tracks successful `fopen`
and replacement `freopen` handles; explicit close removes ownership before
calling the host. Nodes are detached under the lock, with heap operations and
host RPC outside it. A stream opened by a second WASM instance is therefore
visible to main-thread cleanup. Ownership is reserved before opening, so node
allocation failure cannot leave an untracked newly opened file.

`freopen` also no longer returns the old handle as false success when opening
the replacement fails: the old stream is closed and NULL is returned, matching
Microsoft's [freopen contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/freopen-wfreopen?view=msvc-170).
The CRT still represents FILE pointers as raw, unbuffered VFS handles; stable
FILE identity, standard-stream redirection, full mode/text translation and real
buffering are not established by this change. There is no pending CRT buffer to
flush in the implemented write-through path.

`test/test-crt-close.js` covers explicit close exclusion, repeated cleanup,
handle reuse, failed open/reopen, successful replacement, close-error draining,
cross-instance ownership and real guest callbacks writing before closure for
normal and returning cleanup. Real-VFS runs verify retained file bytes and that
the close operation lands. **Newly exposed host-layer gap:** `VirtualFS.closeHandle`
retains records with `closed=true` for an NSIS workaround, while ordinary
read/write methods do not reject those records. CRT cleanup is now issued, but
complete post-close handle invalidation remains open; the test does not pin the
workaround as correct behavior. Concurrent open/close/termination races are not
covered by the sequential shared-memory test.

Full shared-worktree build passes with layout hash `54f430b349c8d55e`; the JS
mirror and both artifacts were regenerated/compiled together. Canonical WASM:
1,470,811 bytes, SHA-256
`6a8c61402a1c3ff68425b5f86ac47c707fb0f352cad2e88874412433d12ebe60`;
compat: 1,471,785 bytes, SHA-256
`03e7ae30bc08ede0923239bd5008d83156ef1a72beebdab554f4328f280c61d9`.
These include other agents' uncommitted work, not clean-commit artifact proofs.
The runtime callback suite also passes; quiet inventory remains 250 + 22.
