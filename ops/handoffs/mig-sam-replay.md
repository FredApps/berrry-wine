# MIG-SAM-REPLAY bounded diagnostic result

Worker `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`; 2026-10-02 UTC.
Reviewed evidence: `scratch/runs/20261001T235600Z-serious-sam-tls-replay/result.json`.

**Visual intro criterion failed.** The preserved TLS-integrated module
`363d07ed0466b0946f0e22bd0ee99253bb22c0275d36d4c168219e9326e4bc39`
reached batch87000, frozen credits0, quitfalse, EIP0x63d5e0, focus/main10008.
Viewport `dlg_get_ctrl_count(0x10008)` returned0. Its screenshot is near-black:
91.76% pure black, only four colors, mean RGB0.08/0.03/0.00. The prior
`20261001T231100Z-serious-sam-demo-memory-host/intro.png` visibly shows the
bright Croteam logo. Both images were viewed. Reaching the same batch/EIP
does not establish equivalent visual progress or implicate TLS by itself.

First-start dialog at16000 rendered correctly and was dismissed using
`cmd dlg-cmd:1`. One subsequent `step71000` observation timed out after30s;
snapshots of the same run at36652,84518,87000 established continued progress.
No duplicate run or extra step was issued. Native GL launch and ctl used
host-access escalation; initial sandbox ctl connections returned EPERM.

Actual command, module hash, log, start/final snapshots, dialog/intro PNGs,
host file hashes and host diff are in the evidence bundle. Host checkout
HEAD `d7790a79d935d4f4a856829774543124f5457db3`; host patch SHA256
`784d4d8ce84487de6a6832897aca3252f196bd02ff2deaaf0ce294864a7d2d31`.
All recorded test/run.js and lib/*.js hashes remained unchanged during this
run. That is host identity, not a reconstructed source identity for the
preserved WASM. Final diagnostics report7824731 API calls and806972349 MMX
instructions; no performance claim.

Owned session8147/PID88752 (launcher exec71926) was stopped via ctl quit
after captures, exit0. Port8147 has no listener. Retained8138/8146 were never
commanded or stopped. No source edits, builds, remote jobs or commits.

Next bounded task for coordinator: determine whether the near-black frame is
intro fade phase or a rendering/TLS regression before declaring the TLS route
visually passed. A new authorized replay can inspect nearby frozen checkpoints
and, if necessary, compare preserved405db/363d modules against identical host
files. Existing route does not isolate module effects from timing or prior
host drift. Do not proceed to gameplay or timer integration on this result
alone. No additional CPU or stepping was claimed.
