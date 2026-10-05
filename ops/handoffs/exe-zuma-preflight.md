# EXE-ZUMA-STARTUP complete-snapshot preflight

Preparation only by `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`,2026-10-02.
No third guest launch, target module execution, build, install or source edit.
Both previous harness failures remain unchanged. Coordinator review is required
before the proposed third attempt.

Snapshot: `scratch/exe-zuma-startup-20261002-preflight3/frozen/`.
All2243 attempt2 file hashes are preserved. Added692 tools/source/package
metadata files, including the entire tools runtime tree and src tree. Compilation
remains disabled. Copied3012 project node_modules files instead of retaining
the mutable package symlink. Static resolution exposed optional Sharp coming
from `/Users/vg/node_modules`; copied that exact11-package/137-file closure
under frozen Sharp, including the available Darwin ARM64 native/libvips
packages. No downloads/install scripts executed. Prior package files unchanged.
All6084 recorded files match their source/copy hashes; manifests separately
record original inputs, added dependencies, package files and ancestor Sharp
source paths. Original source/assets were not changed.

## Static resolution

`check-dependencies.js` uses a comment/string-aware token inventory and Node
`createRequire.resolve`; it does not require/evaluate the target modules.
Entries include copied CLI, host, control-server and manually resolved computed
module targets. `dependency-report.json` records194 visited files and488 edges.
There are no unresolved repository-local literal imports and no remaining
resolved paths outside the frozen tree. This is static analysis, not proof
that every arbitrary runtime branch can execute.

Four unresolved literal imports are explicitly optional:

- `debug/src/node.js` supports-color, inside try/catch; absence affects coloring.
- Sharp utility's `@img/sharp-wasm32/versions`, guarded WASM branch/try-catch;
  this host uses Darwin ARM64.
- Sharp libvips development include/cplusplus packages, caught fallbacks for
  source-build helpers. No source build or package install is planned.

Computed paths were inspected:

- CLI win16-ordinals JSON is copied. Region-map override is absent in the
  inspected environment; NODE_OPTIONS, NODE_PATH and WINE_ASSEMBLY_WASM also
  absent. Recheck those four before launch; explicit --wasm still owns module
  selection. Do not silently follow a new external override.
- Watx loader/region-layout computed paths resolve to copied tools/watx.js and
  its four copied compiler source files. They are captured for closure; no-build
  selects existing module bytes rather than compilation.
- Media-import's five computed module names (sniff/zip/iso/byte-provider/cdrom)
  are explicitly resolved/traversed, although this app does not use media flags.
- Sharp's platform-native path resolves inside the frozen tree. Its first
  versions alias is not exported; its existing caught fallback resolves the
  copied libvips versions JSON. Native binary and package paths were resolved
  only, never loaded. See `platform-resolution.json`.

## Data/flag preflight

`data-preflight.json` records421 required-file checks, zero missing paths and
zero hash drift. Includes SYSTEM_DATA_FILES' sole stdole2.tlb, bundled FONs,
every subset font selected by substitutions.json, every Zuma local manifest
asset, API/ordinal/import-signature metadata, disassembler/SIMD tables and
control-server. Full fonts/system DLL trees and complete game tree are copied.
DLL search covers EXE siblings and system DLL folder; optional nonexistent
Shared_DLLs directories are search candidates, not required dependencies.

The chosen command uses no GL/browser/recording/media/overlay/save/profile or
control-server flag. No extra input file is read: scheduled inputs only write
two PNGs. The control-server's literal closure is nevertheless included.
The module layout stamp helper that failed attempt2 now resolves locally.
This preflight does not claim stamp equality from source or newest-WAT parity;
the unchanged CLI will check the actual module stamp at runtime.

## Exact proposed attempt

Full absolute argv and cwd are in `proposed-command.json`; status is explicitly
PROPOSED ONLY. Command keeps all attempt2 options, c474288d1654353-byte module,
and60s guest/90s owner-only outer deadline. It points to the preflight3 frozen
CLI/module and writes a distinct `scratch/exe-zuma-startup-20261002-attempt3/`
bundle. No thread override: CLI's documented default is cooperative scheduling,
which still supports target-thread APCs. It is not a real-Worker validation.

```sh
node scratch/exe-zuma-startup-20261002-preflight3/frozen/test/run.js \
  --app=zuma_deluxe --no-build \
  --wasm=scratch/exe-zuma-startup-20261002-preflight3/frozen/build/wine-assembly.wasm \
  --quiet-api --quiet-blocks --no-close --stuck-after=0 \
  --max-batches=20000 --batch-size=20000 --max-seconds=60 --png-canvas \
  --png=scratch/exe-zuma-startup-20261002-attempt3/final.png \
  --input=1000:png:scratch/exe-zuma-startup-20261002-attempt3/batch1000.png,8197:png:scratch/exe-zuma-startup-20261002-attempt3/batch8197.png
```

At grant, create output directory, verify manifests/environment unchanged and
use the same direct subprocess90s guard (no shell-wide kill). Stop after the
first guest result or harness failure; inspect output even if exit0. Review
actual screenshots if produced. This proves only the identified artifact and
captured host, not equivalence with current WAT. No further retry is implied.
