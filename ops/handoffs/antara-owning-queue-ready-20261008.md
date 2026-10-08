# Antara owning queue activation — source ready

Fresh clean isolated branch `findings/antara-owning-queue-20261008`, base
`f21fe79a6`; prior runtime branch preserved. Shared HEAD/index untouched.
No native/build slot used. Root integrates explicit paths.

The observer no longer starts from host DOWN. Immediately before the reviewed
ordinary mouse DOWN, the driver requests explicit token/phase activation from
the two actual existing ready Worker links (slots 0/1). Both acknowledgments
must identify that token, phase, slot and live deadline. Missing, late, extra or
replaced Workers refuse the click; partial activation receives stop requests.
Message delivery uses postMessage and diagnostic sequence/pending maps only;
it does not call `_ask` or bump the shared RPC mailbox. UP gets a separately
acknowledged trace window immediately before ordinary release. Release still
occurs after a diagnostic error. No CPU/register/guest/control writes occur;
only the existing `set_win16_trace` flag is changed.

Each Worker has an eight-second absolute deadline, 128 rows, 32 KiB heavy
snapshot reads split between DOWN/UP, and **65536 raw trace words / 100 ms
elapsed callback processing per phase**. This processing counter includes
original log forwarding and observer decoding, and is an elapsed budget rather
than an operating-system CPU measurement. A single bounded import callback can
cross the time threshold before restoration. Raw caps restore tracing immediately;
UP can use its reserved budget once. Partial frames and cap reason are retained.
Idle/paint rows still filter before getters; receipts no longer add log traffic.
Original imports retain receiver/result/exception and execute exactly once.
Errors restore the flag; failed restoration is reported and forbids rearming.

`node test/test-antara-win16-callback.js` passes: explicit owning child route
without any host DOWN, acknowledgments and late-worker refusal, separate raw
word/processing budgets, framing, original forwarding, error cleanup, deadline
inside getter/buffer/translator, import validation rollback, newer hooks and
restore failure. Generated original Worker and real WorkerLink parse/receipt
checks pass. This is collector coverage validation, not guest delivery proof.

Matching fresh immutable preparation:
`scratch/runs/20261008T0101Z-antara-owning-queue-ready`.
Accepted 503-member archive `8007a9b5` is hardlinked unchanged; original media
and module/source stay unchanged (`f62ab3c9`, WASM `4dc5ac2c`). Two explicit
private JS overlays produce 505 final pins: Worker `8018f609`, Link `268a608e`,
observer `86921bc5`. Real HTTP preflight verifies all 535 HEAD routes, five
full GET SHA checks, a range response, exact optional 404 and zero pending
streams/errors. No fixture copies or in-place changes to published evidence.

Root board review/grant at 00:57:06 authorizes the next sole remote
240 s transfer / 120 s browser / 90 s cleanup after final sealing and independent
prior PID/socket/Chrome/disk checks. Crimsonland actually released at 00:55:54.
The old boat expires 01:03:26; use a fresh no-environment temporary boat when
the full budget plus margin cannot fit. Remain this worker for the run.
Record activation/cap outcomes honestly and authenticate original segmented
owner/caller code before attributing guest behavior. An early cap or failed
acknowledgment cannot establish callback absence. Installation/gameplay/cause
remain unmeasured; no production guest repair follows this source phase.
