# COMI timer configuration on current main

Read-only source audit of main `35c55d98`, 2026-10-05. No runtime or audio
quality qualification was performed.

`host.js:1022` initializes `mmTimerThread` to true. The registered
`curse_monkey_island_demo` entry has no opt-out. The browser shell sets
`wine.mmTimerThread = app.mmTimerThread !== false`, and host initialization
passes that value to `set_mm_timer_thread_mode`. The `mm-thread` query parameter
can still override it for a diagnostic run.

The ordinary route therefore selects the timer-thread configuration used by
the earlier successful `mm-thread=1` comparison. This establishes configuration
equivalence only: it does not establish identical runtime code, playback or
audible output. An additional app-specific flag patch would be redundant.

Next: qualify ordinary playback and record audio on the current build in a
serialized browser slot. Preserve the earlier comparison as historical
evidence, not current sound-quality acceptance. Source excerpts and exact line
numbers are in
`scratch/comi-audio-investigation-20261003/current-default-audit/source.json`.
