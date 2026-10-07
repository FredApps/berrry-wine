# Winamp original exception diagnostic ready

GLD3D-WINAMP-EXCEPTION-20261007, source/JavaScript preparation only. Parent
`codex:01a0ff91` owns resource grants and integration. Worker checkout:
`/home/user/wt-winamp-exception-20261007`, base `72e306790`.

The retained complete-closure reproduction already establishes the original
Winamp 2.91/MilkDrop 1.04e ordinary illegal-operation `(2)` dialog. It does not
establish the exception EIP, API cause or correct SEH routing. No new guest run,
build, provision, browser, loader audit or compatibility repair was performed.

Source audit finds that `$raise_exception` already emits integer marker
`0xCAE8C000`, exception code, then EIP. Browser guest RPC can suppress these
imports without `forwardGuestLogs`; the receiving API logger also filters raw
integer markers according to its last API-name latch. The previous dialog was
in an actual guest worker starting at `0x440330`. A page-instance CPU snapshot
would therefore describe the wrong instance.

`tools/winamp-exception-observer.js` observes the existing imports **inside the
owning worker**, forwarding each original exactly once with its receiver,
return value and exception intact. It arms only for start address `0x440330`.
It records existing API entry/exit/integer events; on the built-in CPU exception
marker it emits recent history plus register, stack, SEH-chain and original-host
scope/callback snapshots. RaiseException and MessageBox checkpoints independently
flush history and capture routing evidence. Raw eight stack argument words are
not claimed as eight typed API arguments. COM ordinal identity remains in the
integer stream, so resolve it against the pinned API table during analysis.

Snapshot reads use the pinned **JavaScript** `memUtils.g2w` translator and linear
memory. They never call guest_read*, guest_to_wasm or setters: their miss paths
can themselves raise exceptions. Missing translation produces null. EIP from the
built-in marker may identify a faulting block rather than the exact decoded x86
instruction; compare captured instruction bytes/previous EIP with aligned
disassembly before claiming an instruction address. Fault access address is
not exported by this diagnostic; do not invent it. If the original raises no
CPU marker, inspect RaiseException/history/checkpoints before adding WAT logs.

Bounds: 20 seconds from visualization-worker initialization, 512 recorded
events (including exception words), last 128 events retained, all pre-cap exception snapshots, eight SEH frames,
32 stack words, 32 instruction bytes. A timer restores owned wrappers and emits
summary/history; count/time caps and foreign-wrapper conflicts are explicit.
Closure checks precede any memory/register reads or diagnostic output. Event
closure immediately restores owned wrappers; deadline closure occurs on the
first import at/after the deadline or the existing timer. Retained wrapper
references remain inert and forward the original exactly once. One final cap
contains any unflushed history; timer/finish calls cannot emit a second summary.
No blocking breakpoints, forced return values, guest state edits or render calls.

Prepared bundle:
`scratch/runs/20261007-winamp-exception-final-ready/`. It has 341 verified original
source/fixture pins and 15 original fixture hashes, with original absolute
fixture paths retained. Module is
`7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`, source
`0cbc1c6ffd997f5ab31142b4f2d9d57b318d05c6`. Runtime manifest separately identifies
the private diagnostic worker and observer. Original worker is included for
review. Earlier preparation/ready/closure-ready/runtime-ready bundles are
intermediate receipts; use **final-ready** for transfer. Follow-up commits
`8bbbe8986`, `504484532`, `2f27848ef`, and `6c688bd7c` close observation,
allow/hash the private assets, and stop byte access when the deadline crosses
inside address translation. Final observer SHA-256 is
`ab2036da1f4ab485d2cb03e4f2c3ce3dedf2a44543bb7c18af5699a742e956e6`.
The 349-file archive is 7,775,286 bytes, SHA-256
`404aefef55b5ad6bdff8ae35fac4222a4562e9eb82db8c9610ce56d74c0c0a49`;
it was assembled through temporary symlinks with zero duplicate fixture-tree
copies. The real asset handler serves both private files with their exact pins
and closes/drains cleanly (`check-assets.js`, `asset-validation.json`).

`tools/prepare-winamp-exception.js ABSOLUTE_FRESH_OUTPUT` regenerates from retained
local pins and fails on any drift; it never performs transport. Generated
`transfer-files.json` maps local files to a **new** private remote prefix
`/home/user/winamp-exception-20261007`. `serve-plan.json` preserves original aliases
and adds only the observer URL. `browser-pins.json` verifies actual runtime
bytes, including the private JS override. Driver preserves the ordinary route
and cleanup harness; Ctrl+P holds P for 350ms with balanced releases.

Requested remote bounds: one 120-second transfer and one 240-second browser
session, with at least 90 seconds reserved for cleanup. Require explicit parent
grant, independent prior-owner PID/browser/socket checks, current sandbox info
with enough TTL (at least eight minutes), and disk floor >2GiB. Do not reuse
hardcoded expiry or deleted remote files. The driver requires actual
`--expires=ISO_TIMESTAMP`, `--slot-granted`, `--automation-granted`, and
`WINAMP_PUPPETEER` pointing to a verified available remote installation. No 403
retry. No local browser. Keep priority game lanes ahead of this request.
Parent grant at 23:37:38 UTC authorizes these bounds and fresh no-env provisioning
after limits checks, conditional on Tiberian's actual terminal release after
Antara. Antara released at 23:41:57 UTC; Tiberian retains next priority.

Before launch, stage the transfer manifest and rehash all runtime files. Run
ordinary Repeat/Play/Ctrl+P/Visualization/MilkDrop/Start using reviewed scenes.
Capture full `[winamp-exception]` JSON console messages (driver permits 64KiB
per diagnostic message), retained normal console/errors/requests, original hashes
before/after, cleanup and independent actual PID termination. Publish a new
self-contained result.json last, after screenshots have been inspected. Do not
reuse the preparation bundle as runtime evidence. A screenshot does not qualify
visualization, FPS or audio.

Validation: `node tools/winamp-exception-observer.test.js` passes original
receiver/result/error forwarding, target/non-target worker activation, exception
sequence, sparse/null memory snapshot, exact memory immutability, caps and
foreign-wrapper restoration. Generated driver/worker parse with `node --check`.
All 341 original files rehashed. No native tests or build run. Actual diagnosis,
generic causal repair and ordinary validation remain pending remote grant.
