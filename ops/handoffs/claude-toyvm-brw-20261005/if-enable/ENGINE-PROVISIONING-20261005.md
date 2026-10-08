# V8 / SpiderMonkey shells for the disassembly gate: provisioning record (2026-10-05)

Root authorized this at about 19:41Z, with no user approval gate. The conditions: measure first, keep
a 100 MB reserve, install user-local and isolated, delete no evidence. No benchmark, disassembly or
guest execution was done; Daggerfall was live.

## Source of truth: what jsvu installs

- jsvu 3.0.5's published package (`https://registry.npmjs.org/jsvu/-/jsvu-3.0.5.tgz`, 19,415 B) was
  read only for its engine URL logic, then deleted.
- **V8:** `https://storage.googleapis.com/chromium-v8/official/canary/v8-linux64-rel-<version>.zip`.
  The version comes from `…/v8-linux64-rel-latest.json`, which gave **15.7.45**.
- **SpiderMonkey:**
  `https://archive.mozilla.org/pub/firefox/releases/<version>/jsshell/jsshell-linux-x86_64.zip`. The
  version is the newest entry in `product-details.mozilla.org/1.0/firefox_history_development_releases.json`,
  which gave **158.0b4**.
- `npx jsvu` itself was **not** used: it would add an npm cache, and it installs into the shared
  `~/.jsvu`.

## Measured before downloading

`zip-sizes.js` sends one HEAD request, then a Range request for the zip tail, and parses the central
directory:

| engine | zip bytes | unpacked bytes | files |
|---|---|---|---|
| V8 15.7.45 | 21,354,732 | 66,028,774 | d8 54,831,144; icudtl.dat 10,822,000; snapshot_blob.bin 374,128; v8_build_config.json 1,502 |
| SpiderMonkey 158.0b4 | 18,252,506 | 44,907,472 | js 44,657,616; libnspr4.so 221,024; libplc4.so 16,424; libplds4.so 12,408 |

- **Free space before:** 352,030,720 B.
- **Plan:** one engine at a time, each zip deleted after extraction. Each step required free > zip +
  unpacked + 100 MiB, re-checked before the step.

## Installed (verified against the publishers' checksums)

| engine | path | verification | unpacked |
|---|---|---|---|
| V8 | `/home/user/.local/opt/toyvm-engines/v8-15.7.45/d8` (with `icudtl.dat` and `snapshot_blob.bin` beside it) | GCS `x-goog-hash` md5 `UUyGpE8MlL3h55bgwtDWcw==`: match | 66,028,774 B, exactly as predicted |
| SpiderMonkey | `/home/user/.local/opt/toyvm-engines/sm-158.0b4/sm` | Mozilla `releases/158.0b4/SHA512SUMS` entry `jsshell/jsshell-linux-x86_64.zip` (`d5e01cfa…16cd90a`): match | 44,907,472 B, exactly as predicted |

- **The SpiderMonkey `sm` wrapper** sets `LD_LIBRARY_PATH` to its own directory and execs `js`, as
  jsvu's installer does on linux64.
- **Total:** 110,936,515 B (+ the 193 B wrapper).
- **Version checks (no guest, no wasm):**

  | command | output |
  |---|---|
  | `d8 -e 'print(version())'` | `15.7.45` |
  | `sm --version` | `JavaScript-C158.0` |
  | `sm -e 'print(typeof wasmExtractCode)'` | `function` (the testing function `tools/wasm-native.js` needs) |

**How to use** (`tools/wasm-native.js` reads `$SM`/`$D8` before its default paths):

    SM=/home/user/.local/opt/toyvm-engines/sm-158.0b4/sm D8=/home/user/.local/opt/toyvm-engines/v8-15.7.45/d8 \
      node tools/wasm-native.js --wasm=<tree>.wasm --wat=<tree>.wat --func='$jmp' [--engine=v8]

## Disk

- **After the install:** 239.6 MB free.
- **About 19:44Z:** free space swung to **0** (one of my shell writes failed with ENOSPC; only a
  small copy was affected, and it was redone), then back to about 120 MB within a minute. The cause
  was not this install, which was complete and fixed at 110.9 MB. Something else on the box writes
  and deletes large files. Posted to the board.
- **Current:** about 120 MB free, above the 100 MB reserve. Remove this install by deleting
  `/home/user/.local/opt/toyvm-engines` (110.9 MB) if space must be recovered; it holds nothing else.

## Not done

No disassembly, no benchmark, no guest execution. Those wait for an explicit root grant after
Daggerfall/Arena and the queued correctness run.
