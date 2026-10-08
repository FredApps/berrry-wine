# Comanche 3 resource loading: original work authenticated, flight incomplete

Sole worker NEW-GAME-COMANCHE3-DEMO-20261007; no subagents. Clean isolated
branch `findings/comanche3-resource-loading-20261008`, explicit base
`83ef822fb4204145b642c507918739ba7c1626d5`. Root integrates/pushes the two
documentation paths. No interpreter, input, paging, installer, or catalog change.
Shared HEAD/index and prior branches were preserved.

Evidence: shared `scratch/runs/20261008T0806Z-comanche3-resource-loading/`.
`result.json` is published last; its index pins the self-contained artifacts.

## Original loading and completion conditions

Before launch, the prior decoded original image and saved virtual mapping match
five loader/refill spans exactly. `27567` is the shared LZW decoder: output EDI
is compared with `[8aa8]` at `275e3`; token AX=`101` also terminates at `275f0`.
The dictionary is freed at `2763d`, then `27649` returns. LZR1 obtains the
declared length from its header; LZP1 obtains width × height at `273ed`–`27408`.
Both use the same decoder. An individual resource return is not whole mission
completion. RESOURCE2xxx has 2,234 twenty-byte directory records with the
filename XOR key `aceddead`; the directory maps sampled file positions to assets.

One fresh original launch uses ordinary public keyboard press/release only:
Argon → Gallant Venture → Haystack → briefing → map → loading. Five Enter
requests correspond to five reviewed screens; none is sent during loading.
The last Enter requests map Next. No selection defect was established or repaired.

Independent JS transcription of the original decoder reconstructs the three
1,048,576-byte terrain resources. Live 32-byte windows match the reference at
M.PCX output position650341 (`27699`) and C.PCX position667693 (`27705`).
The temporary file grows to5,242,880bytes, and resource reads advance to
`C2M1D.PCX`. This is continued original work, not an authenticated stall.
The reference preserves the original whole-string bound check; C.PCX writes
one extra byte before that check. This is not an interpreter defect claim.

The coherent final read at08:37:46.617 authenticates stack call sites:
`cb317` → `67907` → `2dd58` → `2dac0`, inside the original mission's palette
initialization. `2dd58` constructs a65,536-entry blend table; CH increments
at `2de49`, then CL at `2de51`, and both wrapping returns at `2de59`.
The same invocation's reconstructed loop ordinal advances1287 →3566 →12922.
Later08:38:42.811 stack returns identify the next original palette call,
`67933` → `2f72d` (return `67938`), with outer return `cb31c`.
This supersedes an interpretation that the first blend loop remained active.
It does not authenticate every instruction in a whole trace.

Six differences in the active nearest-color worker are original RGB immediate
patches, written by original `2dac0`: components109/89/113 become54/44/56.
The writer and blend caller match the original exactly; the worker matches
after accounting for those six original writes. No guest state was forced.
`cb161` maps briefing/map/init; later `cb3c1` checks a private tick difference64
before the `cb403` mission rendering/input loop. Flight was not observed.

## Observation cost, identity and limits

Fresh no-env boat `bx_nbgug7m7`; root owns lifecycle, lease expiry09:16:19.319Z.
Actual Chrome151.0.7922.108, tailcall/386, paced10MIPS, JIT off, silent;
CPU SHA91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf.
All43 source modules equal the prior final-input closure; actual VM bytes,
served bundle and eleven installed originals have separate hash receipts.
This is the actual dashboard launcher with a private localhost fixture bootstrap,
not production catalog/authentication/deployment qualification.

No onEntry observer is installed. Sparse30second observations use pure JS
page-table/physical reads; the first full reader audit and final44,302,336-byte
coherent memory read each preserve RAM and all exported getters exactly.
All Puppeteer connections use `defaultViewport:null`; captures show the whole
canvas. Narrow `getAll` registers and non-image DS samples are not used as
32-bit output progress. One out-of-routine window is explicitly uninterpretable.

Two unpaired20second JS sampling profiles characterize startup and loading
background work. Startup retires10,456,029dispatches/5,656,319handbacks;
checkProgress has4113/18010self samples even with stuckLimit0. Loading background
retires13,500,485dispatches/7,582,191handbacks; resolver and framebuffer work
are prominent. Old exhausted entry hooks remain callable; the fresh run excludes
them. No paired quiet benchmark/native captures or optimization claim exists.
The late coherent memory acquisition/serialization costs about32wall seconds;
the deadline is not extended for it. Handling notes retain helper failures and
the corrected reference-bound interpretation.

Start08:10:09.126Z, ordinary Stop terminal08:38:52.125Z, immutable ceiling
08:39:30Z. Actual1722.999wall/123.5675099guest seconds,1235675099dispatches;
normal Chrome0, host stopped, guest not exited, held keys0. No cockpit, ordinary
player-directed flight change, generic repair, FPS, or audio qualification.
All24 runtime images and the reference control card are personally reviewed.

## Cleanup and next action

Initial transfer129.059seconds (<240). Immutable retrieval verifies86remote
root files; installed inputs are independently pinned and locally retained.
All13 independently enumerated owned PIDs are absent, no Chrome remains,
baseline sockets match, and all18 transfer pins plus every retrieved hash match
before scoped prefix removal08:39:31.388Z. Cleanup39.263seconds (<90).
Prior1541 indexed Comanche evidence hashes remain unchanged. No remote jobs,
prefix, local watcher, build, or browser remain; root owns the retained boat lease.

Next work should measure the remaining original palette/initialization work and
its host execution cost against this authenticated call chain. Do not repeat
installer, paging, held-key or selection diagnosis, infer a stall from loading
art, queue extra Enter, or merely extend a timeout. Any generic repair requires
a real fails-before/passes-after regression plus original progression. Any
optimization requires paired quiet measurements and the prescribed native
evidence. The gameplay goal remains incomplete.
