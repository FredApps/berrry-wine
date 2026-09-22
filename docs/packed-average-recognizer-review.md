# Packed-average cursor recognizers — 2026-09-22

Pass-5 §P5-3 names `loop_try_avg_shift_cursor` and
`loop_try_avg_round_cursor` as the two largest near-duplicate recognizers.
Both now delegate to `loop_try_avg_cursor`, with an explicit rounded flag.
This removes 109 lines from `07b-loop-match.wat` without merging runtime
instruction handlers or changing the opt-in generic-copy emission gate.

The shared implementation validates the two source loads, equal masks,
shift/add sequence, destination store, three four-byte cursor increments,
countdown and branch. Rounded mode alone validates and emits the three
pre-shift correction operations and the post-average correction add.
It requires seven distinct register roles instead of six. The operation
count remains 17 versus 13, and the fused descriptor retains mode 2 versus 1.
Each form still emits its complete ordinary final iteration to preserve
scratch-register and flag results. New mode branches run during decoding,
not for each averaged pixel; no speedup or neutrality claim is made.

Verification:

- `test/test-packed-avg-run.js` compares fused and ordinary output bytes,
  all general registers and CF/ZF/SF/OF for indexed, shift-cursor and
  rounded-cursor forms. It also covers indexed overlap and budget re-entry.
- Five added cursor near misses check unequal masks in both forms, a wrong
  cursor increment, a wrong correction source and a wrong correction add.
  Each runs with emission disabled and enabled: neither recognizes, and
  output/register/flag state agrees. The original indexed near miss remains.
- Both suites pass, including the neighboring `test-copy32-counted-run.js`
  checks for overlap, sparse-page crossings, short rows and slice resumption.
  Fragment balance (107), logical operands, handler stack cleanup, test-tier
  discovery and whitespace checks pass. The exact-duplicate ratchet remains
  138 groups / 531 members; this change removes near duplication, not an
  exact-duplicate group.

This closes this named near-duplicate pair, not all review recommendations
or the broader safety/performance case for enabling copy super-operations.
No game benchmark, browser capture or full-build result is implied.
