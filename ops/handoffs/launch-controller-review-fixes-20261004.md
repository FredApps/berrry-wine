# Launch controller review corrections

Released `lib/launch-progress.js` SHA256 `19680180bada1e20ac2bd00c4b7d54a8b72663f5d0f3f237b63c92a626a9aee5` and `test/test-launch-progress.js` SHA256 `9aaf881d6456c0cba931f127562390a5c4b5d26ebe92dfadf13d74f041c05e39` to root. Owner source before corrections is preserved in `scratch/claude-launch-ux/implementation/controller-fix-before/`.

Two narrow controller changes: retained Retry presentation applies only while pending, so fast second failures/cancellation show correct terminal actions; promptClose can reveal retained Retry after its deadline despite that shell already being visible. Nested prompts still suppress reveal until the last closes.

Claude's existing DOM fixes were preserved: synchronous paint invalidates queued stale model; unchanged action buttons retain node identity across progress frames. Added actual createDomView tests using a minimal DOM transport, alongside fake-clock terminal/prompt regressions. No copied implementation. Native pointer click synthesis/layout remains browser-owner validation.

28 focused cases PASS. Negative controls: owner-before source fails exactly the three new controller cases; removing stale-paint invalidation fails the terminal DOM case; unconditional footer rebuilding fails the button-identity case. Receipt `scratch/claude-launch-ux/implementation/controller-fix-validation.json`, logs and reproducible JS adjacent. No browser/build/restart/push or host/shell edit.
