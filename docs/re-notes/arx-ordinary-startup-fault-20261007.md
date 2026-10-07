# Arx original-media ordinary startup continuation

The allocator repair is already on main (`85c1f7c68` + `6e6a90a8e`). This
continuation used exact tested source `0cbc1c6ffd997f5ab31142b4f2d9d57b318d05c6`
and module SHA256
`7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`
(1,720,920 bytes). No allocator work was repeated.

All 359 prepared original local pins verified before harness preparation; all
358 retained runtime/new harness pins verified remotely before launch and again
locally at archival. Original ARX.exe remains
`ebd3e2b3b14b678ea70e7aed58daf2ba5eb4d6681a3ea294e603228f84d27aa7`;
Athena.dll remains
`81498563a34111cf807700d1d9fb10f39077b97b35e0e35df23f6e77e936bea8`.
The private original installation manifest, registry recipe, media and defaults
were unchanged. No guest memory writes, configuration overrides, forced UI,
save substitution or teleport were used.

## Ordinary route and blocker

Root explicitly granted the temporary browser slot at 22:02:19Z, superseding
the earlier Winamp-first queue. Independent preflight found previous owner
PIDs absent, no actual Chrome, no owned sockets, about 49 GB available, and
box lifetime through 22:51:07Z. One bounded session on `bx_d8nw3e8t` started
22:02:47Z, with a 600-second guard. It used the original 1280x900 viewport;
there were no Puppeteer observer connections or observer-induced resizes.

The worker personally reviewed every captured screenshot. The startup capture
showed the original Settings with English, 640x480 16bits, GeForce, and OK/Quit.
Ordinary click at 471,568 accepted default OK. After the transitional gray
frame, `title-ready.png` showed actual Arx title artwork. Ordinary Enter was
then issued from that reviewed scene. `after-enter.png` retained the title and
a loading bar; `startup-progress.png` showed the animated intro's illuminated
orange shape. No main menu or player-controlled world appeared.

Ordinary Escape was queued at 22:04:39.646Z from the reviewed intro pixels.
The guest logged `ExitProcess(-1073684987)` at 22:04:40.279Z, and the next
capture showed the stopped desktop. **There is no Escape input-routing event
in the retained console.** The chronological proximity does not establish
that Escape caused the exit. Enter's input-routing events appeared about
14 seconds after its harness command; command submission is therefore not
proof of immediate guest input delivery.

The exit code is unsigned `0xC000DE05`. In the exact retained producer source,
`src/11-seh.wat` calls `$seh_terminate_unhandled` with `0xDE00 | exceptionCode`
when exception dispatch cannot continue; `0xC0000005 | 0xDE00` gives this code.
This identifies the unhandled access-violation exit class. The run did not
retain the faulting EIP, touched address, access type or owning-thread fault
record. It cannot identify a particular instruction, API, renderer operation,
or a new allocation failure. In frozen `lib/guest-rpc.js`, normal browser
Workers make `log`, `log_i32`, and `log_api_exit` local no-ops unless
`forwardGuestLogs` is enabled. `host.js` enables that wire option for verbose
or API tracing. Its main logger prints raw `log_i32` only in verbose mode;
auxiliary API loggers also filter values by their current API latch. Thus
ordinary console logging does not preserve existing SEH marker calls.
No speculative source fix was made.

Next diagnostic: preserve actual owning Worker fault EIP/address, exception
record and bounded original instruction bytes at the ordinary intro-to-menu
transition. Use existing tracing where sufficient, or add a generic bounded
fault receipt with focused coverage if the browser exit path loses that state.
Then diagnose the concrete access before changing emulator semantics. Any
future Puppeteer.connect must pass `defaultViewport:null`. A new browser run
requires a new serialized handoff; this worker did not start a second session.

Root requested source-only causal preparation at 22:06:06Z. Existing
`$raise_exception` emits marker `0xCAE8C000`, exception code and EIP before
walking SEH, and `$seh_terminate_unhandled` emits `0xCAE8C0DE` and exit code.
The minimum existing-trace route is therefore to enable verbose forwarding
before launch and retain bounded raw log values from each actual Worker,
including auxiliary log filtering. A host tracer around `createHostImports`
alone is insufficient: `host.js` subsequently replaces `log_i32`, and the
Worker wire may suppress it before any host handler runs. The current markers
do not include `$fault_address`; record that address plus owning instance
registers and a bounded instruction span in a fault-specific receipt if the
first trace identifies only EIP. Observe in the owning Worker at the fault,
before teardown; page CPU shadows and periodic late polling cannot recover it.
No tracing changes, builds, native sessions or additional browser run were
made during this source-only preparation.

## Evidence and cleanup

Self-contained private run:
`scratch/runs/20261007T220247Z-arx-ordinary-startup-fault/`.
`result.json` contains only relative result artifact paths; the archive includes
the exact candidate, 122 producer source files, six screenshots, commands,
console, request/read hashes, cleanup, terminal and prefix-removal receipts.
`artifact-manifest.json` records and verifies every archived artifact's byte
length and SHA256. Prepared original-media hashes remain in `browser-pins.json`;
bulk private media is not committed or duplicated into the run.

Six screenshots total 2,069,034 bytes. Browser/server closed at 22:04:56.469Z,
Chrome exit0, zero cleanup errors and zero pending asset streams. Driver90946
and Chrome90958 were independently ESRCH at 22:05:22Z, with no Chrome and no
owned listening sockets. After evidence retrieval/hash verification, only the
owned remote harness prefix was removed; the box and shared frozen inputs
were retained for queued Winamp. Local disk remained above 2 GiB. No native
runtime, local browser, subagent or public deployment was used. Shared HEAD
and index were untouched. Root owns findings integration/push and Telegram.

Gameplay remains blocked before menu by the observed guest exception exit.
Audio, FPS, performance, combat and completion remain unqualified.
