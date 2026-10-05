# QueryPerformanceCounter arithmetic, 2026-09-21

The existing handler advertises 1 MHz but computed `ticks_ms * 1000 +
perf_counter_lo` in i32 and wrote zero into the output high DWORD. The first
unsigned product carry occurs at 4,294,967.296 milliseconds (about 71.6 minutes).
Crossing 2^31 microseconds alone does not make the stored LARGE_INTEGER
negative: its high DWORD was zero. The earlier messageboard estimate of
35.8 minutes confused the signed low-word boundary with the full count.

The handler now zero-extends both unsigned inputs before multiplying/adding
in i64, and stores the complete eight-byte result after one guest-pointer
translation. QueryPerformanceFrequency remains 1,000,000 Hz.
[Microsoft's API contract](https://learn.microsoft.com/en-us/windows/win32/api/profileapi/nf-profileapi-queryperformancecounter)
uses LARGE_INTEGER output; this correction is not a new native Win98 timing
measurement or a claim to emulate a specific hardware timer.

`node test/test-performance-counter.js` compiles the current handlers and
checks both DWORDs against BigInt at the signed and unsigned microsecond
boundaries, later carries, unsigned millisecond inputs, and a carry contributed
by the existing poll adjustment. It also checks the single clock sample,
output sentinels, return values, frequency, and stdcall cleanup.

Final tests pass on main and the rsync-updated isolated workspace. Substituting
the pre-fix handler source in memory fails at 4,294,968 ms: actual 704, expected
4,294,968,000. The initial fixture referenced a nonexistent `$esp` global;
after correcting it to the canonical register-memory slot, the positive and
negative tests both reached the intended assertions. Fragment validation and
test-tier discovery pass. No full build-gate or browser gameplay run was made
for this arithmetic-only change.

Remaining clock work is substantial: the shared host get_ticks import masks
to 31 bits and can use Date.now; its rollover/backward jumps are not solved
by wide multiplication. The per-instance synthetic i32 poll increment still
wraps and makes results depend on polling frequency and thread state. A shared
monotonic clock authority is needed for those issues. This change deliberately
does not claim that QPC is now fully monotonic or high-resolution. The reported
Organic Art animation freeze was independently ruled out as caused by this
overflow; no game-performance or animation improvement is claimed here.
