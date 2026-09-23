# Dispatch API-ID follow-up — 2026-09-23

The raw-ID row in `fable-review.md` (P2-2, section 5) is historical.
On reinspection, PeekMessageA/W, MsgWaitForMultipleObjects and the
IDirectDraw vtable base already consume generated `$API_ID_*` constants.
All four ordinary dispatch exits already call `$restore_win32_nonvolatile`;
the multimedia-timer continuation separately calls `$restore_caller_regs`.
These helpers have different register-restoration responsibilities and were
not merged in this follow-up.

Two numeric API comparisons remained in `09b-dispatch.wat`: GetTickCount
(338) and timeGetTime (826). They determine which calls do **not** increment
the clock-spin detector's non-poll activity sequence. Both now consume named
constants emitted by `tools/gen_dispatch.js` from `api_table.json`. The API
table, handlers, polling policy and calling conventions are unchanged.

The existing core architecture regression rejects direct numeric `api_id`
equality/inequality comparisons in either operand order. It also checks all
five Win32 special-case names against the API table and their dispatch
consumers. The generator's existing freshness gate checks the emitted file.
This is a scoped guard, not an assertion that every numeric API reference
elsewhere in the repository has been eliminated.

Validation:

- Generator freshness and core architecture checks pass. In-memory negative
  controls replacing the named comparison with a literal fail as expected
  in both operand orders.
- `test-clock-spin-contexts.js` passes against freshly compiled source:
  bounded contexts, activity/value resets, eviction and stack-safe parking.
- `test-clock-spin-park.js`: 43 passed, 0 failed against the rebuilt artifact.
- Full `bash tools/build.sh` passes, including normal and compatibility WASM
  compilation and data-segment overlap checks. Layout remains
  `68ce5b9062e11919`; silent-stub inventory remains 243 manual + 22 metadata,
  duplicate census 117 groups / 467 members.
- `git diff --check` passes. No benchmark or browser-painting fix is claimed.
