# COMI owning clock snapshot: guest frame wait identified

2026-10-05, /root/corpus_categories. No engine fix. Ordinary registered COMI plus bounded passive private Worker snapshot, not instruction tracing or pristine timing qualification. Runtime session22321 exited0 and closed browser07:44:35.164Z, errors empty; existing dashboard8098 untouched. Active hold scene personally reviewed before arming.

Raw receipt: `scratch/comi-audio-investigation-20261003/clock-poll/attempt2/{clock.json,clock-analysis.json,receipt.json,worker-response-headers.json,cleanup.json}`. Exact EXE SHA `b55524231edacc7d184c22c762d25193d616adc55d0141785fb21b8890d352b9`. WASM remains `f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063`; canonical Worker `3665f7c9584aa472e340f4428ed8bb7408382b63abe916d6573e8a02182bd678`, with separately hashed private observer. This is the old shared-worktree runtime, not the newly published winmm timer implementation. Nothing here measures or evaluates Heroes.

## Exact evidence

64 records hit the cap after1464.77ms. All48 yield14 records have valid reads; all16 non-park records retain invalid/unmapped candidate-return-span errors. A stack top at an arbitrary non-park boundary is not a return address; those records do not support caller attribution. No errors hidden or rerun to replace them.

Every parked record has:

- EIP07500360, IAT00526438 pointing to07500360; thunk metadata first words00126754 and0000033a. Actual EXE import order names RVA126754 as WINMM.timeGetTime; API826 is timeGetTime. This is emulator API-thunk metadata, not native DLL instructions.
- Top stack word4162f2. All48 captured96-byte return-site spans equal the exact EXE file bytes. At4162ef the guest calls `[eax+2c]`; the clock wrapper is initialized at415e1e to416090, which jumps through timeGetTime IAT00526438.
- The wait function4162c0 saves EBX/ESI/EDI and reserves8bytes. At its parked API call, stack+24 is4211bc and stack+28 is5. This unwind is backed by the actual prologue and the direct call at4211b7→4162c0. EDI is5 in every parked record.
- ESI holds the starting clock value. Distinct observed starts differ89–93ms. The emulator deadline is tick+1, not the guest wait target. Intermediate parked samples show tick−ESI reaching81–83ms while the guest continues waiting.

The loop4162f2..416315 computes `trunc((timeGetTime() - start) * 60 / platformFrequency)` and repeats while below EDI. The float multiplier60 comes from EXE45805c. Helper44b194 explicitly selects x87 truncation mode for conversion, then restores the control word. Platform initialization415e2a stores float1000 (`447a0000`) at the clock descriptor. Thus target5 corresponds to about83.33ms, first integer millisecond84 **if that initialized frequency remains current**. The actual frequency word was not sampled: preserve that distinction. Recorded ECX/EAX point to the expected descriptor47f980, but pointer identity alone does not prove its contents.

Caller421168 onward computes elapsed frame work, stores it in game object+88, subtracts that from target field+1c0, then passes the remainder to4162c0. This capture proves the actual remainder is5. Target field+1c0 and elapsed field+88 were not directly sampled.

Audio remains starved:70 writes over5000.075ms; between first and last write3.204354seconds PCM versus4.980680audio-clock seconds, stream origin rebase1.776327seconds. This is diagnostic observation, not a sound-quality acceptance or FPS measurement.

## Meaning and next discriminating step

The repeated main-thread clock parks correspond to an explicit guest frame wait. They are not evidence that the emulator independently invented an approximately90ms sleep. Disabling parking or increasing the execution budget is unsupported by this finding.

Trace source linkage between the audio service registration424ce0 and the guest timer/event dispatch. The audio path has eight4096-byte headers and paired refill calls, with toggle461c08; one4096byte stereo16-bit22050Hz chunk is46.44ms. Why the original expects sufficient servicing during the main wait remains unresolved. A separate25ms timeSetEvent setup exists at43f387 with callback43f3d0→43f440; this alone does not prove it services this mixer.

The next normal passive capture should read actual clock descriptor frequency/function pointer, caller game target/elapsed words, registered mixer descriptor and relevant timer record/callback counters before and during this wait. Establish the live link to424ce0 before enabling a timer mode or modifying callback delivery. This is distinct from CALLBACK_NULL waveOut completion polling. No speculative buffer/park patch and no further runtime in this result.

## Harness correction preserved

Attempt1 failed before guest readiness: private Worker response omitted canonical COEP while supplying CORP. The corrected attempt fetches the same canonical Worker URL, verifies its SHA, preserves original COEP/COOP/CORP/CSP/MIME and only replaces body/framing. Header forwarding tests passed and both canonical/replacement headers are archived. The HTML [Worker initialization algorithm](https://html.spec.whatwg.org/multipage/workers.html) rejects incompatible embedder policies; exact initial Chromium rejection code was not captured. Attempt1 remains incomplete harness evidence, not a guest failure.

Observer and page tests verify mapped-span bounds, no guest writes/destructive getters, caps, exact-source reconstruction, owning-context delegation, original Promise/receiver/arguments/throw/rejection semantics and cleanup. No trace flag, breakpoint or direct guest execution was introduced. `clock-poll/analyze.js` reproduces code comparisons and summary from raw data.
