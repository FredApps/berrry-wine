# Ultima IV: Quest of the Avatar (GOG)

## Source and fixture boundary

The local fixture comes from the Internet Archive `gog_collection` item pinned
in `test/candidate-corpus/manifest.json`. Its RAR is 12,548,654 bytes with
SHA-1 `a75b5a57226650c47fe8f8cdb0872c8289da1cf7`; the contained GOG offline
installer is `setup_ultima_iv_-_quest_of_the_avatar_1.0_cs_(28045).exe`,
12,548,400 bytes. GOG listed Ultima IV for USD 0.00 when this corpus was
verified, but the package remains proprietary and gitignored. Nothing here
grants redistribution rights for the installer or extracted game.

## Direct installer path

The original PE32 Inno wrapper was executed directly in Wine-Assembly, without
host Wine. It extracted a 1,343,072-byte child and called `CreateProcessW` with
this exact handoff:

```text
/SL5="$10001,11966063,192512,C:\setup_ultima_iv_-_quest_of_the_avatar_1.0_cs_(28045).exe"
```

Wine-Assembly intentionally does not implement a general child-process model,
so the wrapper reports that it cannot execute the temporary file and waits in
its error dialog. A debugger dump of the live UTF-16 `CreateProcessW` command
line supplied the handoff above. Running the extracted child directly with the
original installer mounted at the named `C:` path reaches the native Inno
language-selection UI and remains responsive; a bounded run completed 5,000
batches and 47,180 Win32 API calls there.

After proving the original and child paths, the existing local `innoextract`
build extracted the payload for runtime acceptance. This is a local throughput
and process-boundary workaround, not host Wine. The ignored extracted tree is
about 17 MiB.

## Bundled DOSBox runtime

The package contains the 32-bit Windows `DOSBOX/DOSBox.exe`, version 0.74-2.1.
`test/configs/ultima4-wine-assembly.conf` selects `core=dynamic`, mounts the
extracted root as `C:`, and launches the package's `ULTIMA.COM`. The launcher
then transfers control to `TITLE.EXE`, matching GOG's own single-game config.
The 3,000-cycle setting is deliberate: 50,000 nested cycles greatly increases
outer interpreter work. The acceptance runs guest work continuously for a
bounded 30 wall-clock seconds and captures the final frame, avoiding a
machine-load-dependent assumption that a particular batch number represents a
particular amount of DOS time.

The bounded acceptance runs that unchanged Windows DOSBox inside Wine-Assembly,
observes both `Program: ULTIMA` and `Program: TITLE`, and captures the 320x200
title/map intro. The accepted content has at least ten colors, over 40,000
black pixels, and over 1,000 cyan pixels; the earlier orange DOSBox splash
cannot satisfy that signature.

```sh
node test/test-ultima4-dosbox.js
```

## 2026-10-05 ordinary browser character creation (not gameplay)

Session87748 used source94d18605/module2e2fd8d1, the original installed DOSBox0.74-2.1 and existing dynamic-core/fixed3000/sound-disabled config. The sole local registration overlay was explicitly pinned;258production sources and280asset URLs were checked. Normal input reached main menu, I/new name Avatar, male choice, the introduction and virtue questions. The first A choice advanced the abacus; second preamble (Valor/Spirituality) was visible. No player world or movement was reached.

The300sec wall guard ended18:04:02.733Z with browser/server closed, errors[], sessionexit2. It includes operator image-review time; no compatibility fault or timing performance is inferred. Later submitted inputs after terminal were not executed. Immutable evidence: scratch/runs/20261005-ultima4-character-creation/result.json and validation.json; screenshot question2.png is character creation, not gameplay.

Next: fresh600sec ordinary route, reuse the now-observed introduction advance sequence with periodic captures, stop at actual virtue prompts and answer seven visible choices. Personal review of active world and before/after arrow movement remain mandatory. No automatic retry or synthetic save/protocol.

## 2026-10-05 seven choices complete, post-creation save-open failure

Continuation session59296 on the same94d18605/2e2fd8d1 completed ordinary name/sex/intro and seven personally reviewed A/B choices (A,A,A,B,A,B,A). The final narrative was advanced normally. Actual DOSBox program labels then changed TITLE→ULTIMA→AVATAR→ULTIMA→DOSBOX, and the rendered text reads `Opening PARTY.SAV` immediately followed by the DOS `C:\>` prompt. Stable after-save.png confirms no active world. No gameplay/FPS accepted.

Stopped at the concrete boundary, before the600sec guard: clean exit0/browser+serverclosed18:31:41.282Z/errors[]. Immutable result/screenshots/logs/hashes: scratch/runs/20261005-ultima4-post-creation-save-exit.

Source-only distinction: original installed PARTY.NEW exists (502bytes); PARTY.SAV is not a packaged asset and is expected to be created during play, so it must not be added as a fake fixture. Bundled DOSBox source drive_local.cpp uses fopen("wb+") in FileCreate, rb/rb+ in FileOpen and fwrite for writes; rename delegates CRT rename. Current pinned CRT maps wb+ to CREATE_ALWAYS and tracks FILE ownership. These static paths do not establish which call failed here. Next bounded passive observation should preserve actual VFS create/write/move/delete/close return values for PARTY.NEW/PARTY.SAV/MONSTERS.SAV and a small final metadata inventory; no guest writes or invented saves.
