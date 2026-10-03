# MIG-PIRATES-STRETCH — INCONCLUSIVE

Agent `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`, 2026-10-02.
One authorized headful Worker browser ran; no rebuild or rerun. The guest
stopped after English captain selection, before any observed StretchRect or
source-readback/destination-upload event. This does not validate the transfer
path and does not establish a renderer failure or graphics-setting causation.

Evidence: `scratch/mig-pirates-stretch-20261002/`, including `result.json`,
`identity.json`, `probe-identity.json`, `verification.json`, `guest.log`,
`output.log`, command responses and22 reviewed route PNGs.
Browser identity independently reported `build/wine-assembly.wasm`,1654353 bytes,
SHA256 `c474288de1a738d5fa4835d2057c73b563a5d20909251e7e50982f19677e287c`.
All143 inventoried runtime/module/selected candidate files retain their
recorded hashes in frozen copies and shared originals; three private probes
also retain their recorded hashes. This inventory covers the executable,
config, manifest and selected DLLs, not every payload asset. Original config
and assets were never edited. Runtime copies and patches are retained.

Exact command (repository root):

```sh
node scratch/mig-pirates-stretch-20261002/profile.js --app=pirates_2004 --threads --headful --warmup=1 --seconds=1 '--query=?debug&perf-stream' --trace-api=IDirect3DDevice9_StretchRect --relay=MIG-PIRATES --guest-script=gate:scratch/mig-pirates-stretch-20261002/finish-gate@1800 --screenshot=scratch/mig-pirates-stretch-20261002/final.png --report-eval='JSON.stringify({identity:WINE_WASM_IDENTITY,bridgeError:String(runningApps[0].wine.hostCtx.d3d9Bridge.lastError||""),workers:runningApps[0].wine.threadManager.workers?.size})'
```

The helper served frozen runtime files on ephemeral57049, used a unique browser
profile, and removed both the stale-browser function and its startup call.
Private worker probe captured COM2727/StretchRect six arguments, rectangles and
filter; bridge probe captured ordered transfer entry and successful finalizer
return after memory copy. Syntax checks and an asynchronous finalizer/poll
sanity check passed. No probe event was emitted during the actual game route.
The synthetic sanity event is not game evidence. No completed-copy ordering
or caller correlation can therefore be claimed.

Reviewed route: splash → main menu → video settings → Play → cinematic → Crew
Signups → tavern/captains → English captain welcome → stopped guest.
Within this fresh browser's guest settings, water/world sliders were dragged
to maximum and shadows/advanced lighting enabled;800x600 and shaders remained.
PNG10 confirms those settings. Clicks used native coordinates mapped through
`_unmapExclusiveInputPoint`, mouse button1. Play(400,134), Escape cinematic,
Enter with WM_CHAR accepted the default name, English captain(657,296).
Initial Enter down/up without WM_CHAR did not advance Crew Signups; it was
corrected in the same run. All held inputs were released.

Response20 at01:42:53.998UTC shows the captain welcome, live main sequence25439,
EIP5332990 and empty bridgeError. Response21 at01:43:11.507UTC follows an
attempted Escape down/char/up and shows the stopped guest. The terminal guest
log's last recorded input is the captain mouse click, not that Escape, so the
exact stop/input ordering is unverified. Response22 at01:43:38.645UTC confirms
zero running apps and captures the complete retained log. Response file mtimes
are host observation times, not precise guest execution timestamps.

Terminal message:

```text
--- Program exited (worker) --- last block 0x005d0650, before it 0x005d9ae9
eax=0x1d5e2e34 ecx=0xc32e8205 edx=0x1bb8d710 esi=0x1bb38ab0 esp=0x074ff824
frame0=0x00000007 frame1=0x0054a2b0 frame2=0xfffffd78
```

No explicit ExitProcess API/code or fatal message was captured. Coordinator
read-only disassembly of the exact executable found at005d0650: `push esi;
mov esi,ecx; mov eax,[esi+0x28]; test eax; mov[esi+0x24],0; jz005d066e;
mov ecx,[eax]; push eax; call[ecx+8]; mov[esi+0x28],0; pop esi; ret`.
Predecessor005d9ae9 stores `[eax]=0` then calls005d0650. An invalid virtual
Release target is a hypothesis from this sequence/registers; runtime memory
and the indirect call target were not captured. No causal diagnosis follows.

Cleanup: owned exec75274 returned exit0 after the finish gate; browserPID27445
and its private server closed through helper cleanup. Coordinator independently
verified the owned browser/helper/profile processes absent and reassigned the
local CPU slot. Optional escalated listener/process inspection was interrupted;
the listener-specific check remains unverified. No commands changed retained
8159 or any reference session. Own board watcher retired. No further run is
assigned. Final helper frame-timing output sampled a stopped guest and must not
be treated as gameplay or performance evidence; report-eval cannot read the
removed runningApps[0]. The saved response20 is the last bridge-error sample.
