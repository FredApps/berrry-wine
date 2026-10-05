# EXE-ZUMA-STARTUP — identified startup/loading observed

Final authorized attempt3 reached reviewed640x480 Zuma Deluxe title/loading
artwork on c474288d without the historical missing QueueUserAPC error. It ended
at the planned60s guest budget,4290 batches/853956 API calls, process exit0;
the90s outer guard did not fire. No menu responsiveness or gameplay verified.
The empty dark progress region does not establish a hang. Batch1000 image is
black; batch8197 was never reached. No further run was started or needed for
this bounded startup observation.

File-backed evidence:
`scratch/runs/20261002T042949Z-reflexive-zuma-deluxe-startup/result.json`,
with exact command, logs, actual PNGs, execution and pre/postflight records.
Attempt-local bundle: `scratch/exe-zuma-startup-20261002-attempt3/`.
Result outcome is `timeout` to distinguish the planned observation limit from
menu acceptance; summary explicitly says this is not a demonstrated hang.
Default CLI cooperative scheduler was used, with five active guest threads
at end. BASS loading/DllMain returned and workers resumed; callback ABI was not
independently traced, so do not infer complete APC correctness from this route.

All6084 frozen module/host/data/package files retain their recorded hashes.
Module remains1654353 bytes,c474288de1a738d5fa4835d2057c73b563a5d20909251e7e50982f19677e287c.
Current WAT/module equivalence is not claimed. Loader warnings report absent
shell32.dll/ole32.dll real-PE files in the original copied DLL corpus, falling
back to WAT stubs; no causal failure from those warnings was observed here.
Owned subprocess15759 exited after60.641s. Local CPU released; originals,
foreign jobs and both prior failure bundles preserved.

Disposition: historical missing-import startup error was not reproduced on this
identified module/host and startup progressed to loading. Further menu/gameplay
acceptance, if requested, needs a new bounded task/grant. No emulator edit or
stub was justified. The two packaging failures below remain part of provenance.

## Prior attempts

Agent `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`,2026-10-02.
First authorized attempt evidence:
`scratch/exe-zuma-startup-20261002/result.json`, exact argv/cwd in
`command.json`, full output and2138-file frozen identity.

The private freeze omitted `test/binaries/tlbs/stdole2.tlb`, required by
`SYSTEM_DATA_FILES` at copied `test/run.js:2597`. ENOENT occurred before guest
execution. No interim/final PNG was produced. The harness caught/logged the
error yet exited0; exit status alone is not a PASS. Owned subprocess8391 is
terminal after0.766s; neither60s guest nor90s outer guard expired. No module,
source or original asset was edited, no build/GL/browser job started.
All2138 frozen file hashes remain unchanged.

Attempted module SHA256
`c474288de1a738d5fa4835d2057c73b563a5d20909251e7e50982f19677e287c`;
EXE SHA256 `60bf0df7695914e4f8238b5c99f665b8484d3c0dea9378389f95244c9712446c`.
No observation about QueueUserAPC or current Zuma startup follows from this
failed harness setup. Source/module equivalence remains unproven.

The coordinator subsequently granted one corrected-freeze attempt: inventory and freeze all
SYSTEM_DATA_FILES plus DLL/font support inputs, sanity-check required paths,
then one corrected-freeze run with identical module/options and60s/90s limits.
Keep this failure unchanged and use a distinct second bundle. No automatic
retry or implementation change is authorized by this handoff.

## Authorized corrected freeze, attempt2

Distinct evidence: `scratch/exe-zuma-startup-20261002-attempt2/result.json`.
All2138 original frozen files were copied without changes. The dependency-only
delta adds105 independently source→copy hash-verified files: entire fonts and
system DLL directories (previously linked), plus the sole SYSTEM_DATA_FILES
entry `test/binaries/tlbs/stdole2.tlb`. `dependency-delta.json` enumerates them.
All2243 hashes remained unchanged after the attempt; module/EXE hashes and
all engine options were identical, with only private output/root paths changed.

Attempt2 reached the runtime module-layout stamp check, which requires
`../tools/region-layout-hash.js` at copied run.js4219. The snapshot omitted that
runtime tools dependency, producing MODULE_NOT_FOUND before guest execution.
This was another incomplete private harness freeze, not a guest/module-layout
mismatch. Owned subprocess10194 returned0 after1.204s despite the logged error.
No guard expired, no image was produced, and QueueUserAPC was not exercised.
No further retry was started. Local CPU is released; foreign jobs untouched.

Before any further runtime grant, statically close every local require and
runtime data dependency of run.js/host/lib, including tools/region-layout-hash
and any control-server support, and verify every required path/hash. Do not
try successive one-file fixes by launching the guest. A third attempt requires
an explicit grant and a new bundle; no source change or build is justified by
either failure. At that attempt2 checkpoint, Zuma compatibility remained untested; the later attempt3 observation is recorded at the top.
