# MIG-SAM-VISUAL paired intro replay

Worker `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`; 2026-10-02 UTC.
**PASS for the bounded intro transition.** The near-black87000 capture is
followed by a bright GODGAMES publisher logo at90000 in both preserved builds.
This comparison finds no TLS-specific rendering regression at these checkpoints.
It does not explain every difference from the older Croteam screenshot, nor
establish normal menu input, gameplay, or complete production integration.

Reviewed bundles:

- `scratch/runs/20261002T001100Z-serious-sam-visual-control/result.json`
- `scratch/runs/20261002T001100Z-serious-sam-visual-candidate/result.json`

The control module SHA256 is
`405db372519c5071a67b765ef378c112bdd5c2cd9b7c4d6e53579187a11a84e0`;
candidate is
`363d07ed0466b0946f0e22bd0ee99253bb22c0275d36d4c168219e9326e4bc39`.
Both ran sequentially on newly owned8147 with the same host files, frozen
route,10000 blocks/batch,1ms/batch, no-uop, headlessGL,1800s guard. One
`step16000`, `cmd dlg-cmd:1`, one `step71000`, capture87000, then `step3000`
and capture90000. Both long-step observations timed out; snapshots showed
continued progress in the same process. No duplicate run was started.
95000 was unnecessary after the bright publisher logo. No gameplay expansion.

| Checkpoint | Reviewed image | Exact differential |
| --- | --- | --- |
| 87000 | Near-black transition | PNG bytes, snapshot JSON and captured GL JSON identical |
| 90000 | Bright GODGAMES logo | PNG bytes, snapshot JSON and captured GL JSON identical |

87000 PNG SHA256:
`e4a443b55c8a9f239b1ea5ef21a51aeebdcb4b836f0e559d18455e0f57d21b90`.
90000 PNG SHA256:
`a547895234d483d43990bbcca943c3ce5efec3133dd7cecf5997ea238cfd9bb4`.
The original MIG-SAM-REPLAY near-black image is also byte-identical to the
paired87000 image. That earlier failed checkpoint/result was preserved.

At87000: EIP63d5e0, GL calls0x1cdff, vertices0x12a8e, flushes0x20ac.
At90000: EIPc19ff4, GL calls0x27910, vertices0x186f2, flushes0x22b4.
Both checkpoints have frozen credits0, quitfalse, viewport640x480,
matrixError0, untrusted0, attribDepth0, viewport dialog ctrlCount0.
The recorded GL getters are a bounded subset of GL state, not a full state
equivalence proof. Repeated sparse AV log entries were handled stream faults;
snapshots and advancing GL counters established progress.

Both bundles contain exact commands, actual module hashes, stdout, checkpoint
images, snapshots, GL captures, source-host identities and comparison hashes.
The recorded `test/run.js` and `lib/*.js` hashes stayed unchanged across both
runs; host diff SHA256
`02f60dc603547da295228a82b0cff5a627a7a729081d5dd876698fdd0eb9701d`.
The changed diff hash relative to earlier replay is not itself proof of changed
runtime bytes: the checkout acquired commits in between. Per-file manifests
are the runtime-content identity. Module source closure was not rebuilt.

Both owned runs quit via ctl and exited0 (launcher exec58861 control and61254
candidate).8147 listener absent. Local CPU/nativeGL/port claims released to
coordinator. Retained8138/8146 were never commanded. No source edits, build,
remote work or commit. Own watcher38875 retired after handoff.

Next authorized implementation candidate remains MIG-SAM-TIMER from
`mig-sam-review.md`, subject to coordinator ownership grants. Its prerequisite
diagnostic TLS intro replay now has positive visual evidence through90000.
Later full-source integrated replay, reproducible input setting and normal
launcher/gameplay verification remain outstanding.
