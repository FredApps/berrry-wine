# Current result — 2026-10-03

Current-source browser reproduction confirms running Worker waveOut streaming with callback type 0 and main-thread producer 0. Audio queue starvation is reproduced. Independent passive timing review finds 19 gaps totaling 859 ms; previous DONE was already observed 31–47 ms before the next write. Exact guest pacing/execution/mixing cause remains unresolved; no emulator fix or deployment. Browser and recorder are closed. See comi-audio-followup-20261003.md and docs/re-notes/curse-monkey-island-demo.md for results; source-only observations below describe earlier stages.

# COMI audio source investigation

Source-only proposal and exact receipts: scratch/comi-audio-investigation-20261003/source/PROPOSAL.md and source-hashes.json. Both DirectSound and waveOut imported; active path unproven. Default worklet ring/Worker local cursor may prevent page stalls but cannot compensate missed guest refills. Need actual symptom and producing owner/path before repair. Root owns live reproduction. No source changes/build/tests/runtime.

## Public host follow-up

Saved-source routing matrix: scratch/comi-audio-investigation-20261003/source/PUBLIC-HOST-ROUTING.md. Public host2796 enables liveAudioRing after successful Worker startup; missing getImports default affects cooperative fallback-loop promotion only. Play can route once module ready even with flag unset; no-audio-worklet is the actual router opt-out. Main sharedAudio voice closure sees main hostCtx assignment. Public/current guest-rpc audio code identical, sole captured diff sync-object capacity. Active COMI path remains unverified. No runtime/source edits.

## Actual stream evidence follow-up

Root current-source capture proves waveOut stream, running AudioContext, idle worklet. Source-focused mechanism and bounded existing profiler plan saved source/WAVEOUT-REFILL.md under scratch/comi-audio-investigation-20261003. Page timeout polls completion8..50ms then sets shared DONE; guest refill can lag either side. Root bytes/audio-clock/rebase samples support queue drainage. Actual callbacktype and producer tid pending; function-pump cooperative-only reference is a conditional concern, not COMI diagnosis. No new runtime/source changes.

## Final bounded COMI PE audit; ownership released

See `scratch/comi-audio-investigation-20261003/source/PE-WAVEOUT-REFILL.md` and four narrow disassembly artifacts. Proven CALLBACK_NULL / WHDR_DONE polling, eight 4096-byte observed-format slots, paired refill calls and outer service chain. No proven Sleep/timer pacing cause. Root actual runtime findings supersede earlier conditional callback-function hypothesis. All source/handoff editing ownership released to root; no runtime/build/production edits performed in this audit.
