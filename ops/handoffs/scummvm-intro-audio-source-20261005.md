# ScummVM intro content versus audio transport

The mostly silent Warner capture does not establish a remaining synth/mixer failure. Matching ScummVM0.8.0 source separates Queen music from sampled effects, and the exact floppy archive contains both. Actual driver selection, active MIDI notes and the precise current cutaway were not sampled, so expected audible content for these12seconds remains unproved.

Exact local queen.1 is22677657bytes, selecting PEM10 English PC floppy in resource.cpp's size table. queen.tbl QTBL offset8 has1076entries: AQ.RL at2598062,size409402; COPY.CUT6661344,size134; CLOGO.CUT6590464,size170; CDINT.CUT5897551,size6142;167 .SB effects. All selected spans are within queen.1. Inventory is `scratch/scummvm-av-20261003/source/intro/fixture-resources.json`. No missing music archive inference is supported.

Matching upstream `queen/queen.cpp:430–438` requests MDT_NATIVE|MDT_ADLIB|MDT_PREFER_NATIVE. `sound/mididrv.cpp:120–149` chooses Windows MIDI for Windows auto/native preference; AdLib is a fallback/configuration alternative. Actual EXE build/configuration selection is not thereby proven. `queen/music.cpp:318–324` loads AQ.RL for this non-demo. `queen/sound.cpp:87–125,178–185` loads sampled .SB effects; these differ from song scheduling.

Current host `lib/host-audio.js:1964` explicitly routes MIDI synthesis directly to WebAudio rather than waveOut PCM. Therefore continuous, mostly zero waveOut buffers can coexist with MIDI music; the monitor would include both only if MIDI is actually playing. The capture did not inspect ctx._midiOut.devices or note state. No MIDI log line appeared, but absence of such a line is not proof of no music.

Intro source `queen/logic.cpp:2125–2141` sequences COPY.CUT, CLOGO.CUT, CDINT.CUT then credits. Bounded reads of the actual first cutaway records (20byte resource header skip,12byte cutaway header,17BE16 fields) show COPY's single object has room95 and limitBobX1=0, hence no direct object song cue. CLOGO's first object likewise has no direct cue. `cutaway.cpp:205–211,854–855` converts only negative limitBobX1 into a song and calls playSong. This does not exclude room-change or later-record cues, nor prove the live Warner image is precisely COPY's object. Do not declare total intro silence expected from this partial parse.

Smallest next evidence, source preparation only: extend ordinary read-only JS snapshots with existing MIDI device count/program/channel volume/active note keys and synth/context state, alongside wave queue/voice. Tie a later natural scene to archive/cutaway cue or actual ordinary menu music setting before another attributed sample. If no expected song cue is established, avoid repeating the same Warner intro. No driver override or synthetic note injection. Fullscreen remains separate.

Primary version-matched sources (corroborating source, not byte-identical compiled-code proof):
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/queen/queen.cpp
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/sound/mididrv.cpp
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/queen/resource.cpp
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/queen/sound.cpp
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/queen/cutaway.cpp
- https://raw.githubusercontent.com/scummvm/scummvm/v0.8.0/queen/logic.cpp

No runtime, build or engine changes for this audit. Ordinary attempt2 audio transport findings remain separate in scummvm-attributed-intro-20261005.md.
