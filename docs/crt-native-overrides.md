# Native CRT export overrides

When an app ships a real Microsoft C runtime DLL (`msvcrt.dll`, `msvcr70.dll`,
`msvcr71.dll`), every CRT call runs that DLL's x86 through the interpreter. A
handful of exports are pure functions of their arguments and a few globals.
For those, a native WAT answer that returns exactly what the authentic code
returns saves the interpreter the whole call. This page covers:

- which exports were worth it,
- how they are bound,
- what "exactly" has to mean for each one,
- what it bought.

## How the census was taken

`tools/crt-hot-exports.js` charges every executed block inside a CRT module to
a function. The function entries are the module's named exports, plus every
address a runtime `call` edge landed on, which is how internal helpers such as
`_getptd`, `_output` and `_woutput` get names. It then reports each export's
self and inclusive share of **all** block entries in the window, and its call
count. The input is `test/run.js --handler-hist --handler-hist-thread=0
--hist-json=F --hist-json-blocks=0 --edge-hist`.

**The shares are a lower bound.** Blocks that ran inside a uop program are not
in the per-block list.

Measured per app. Threaded block-entry share, main thread:

| app (CRT) | window | CRT total | hot exports (inclusive share / calls) |
|---|---|---|---|
| UT2003 demo (msvcr70) | load 370..520 | 21.3% | `floor` 19.5%; `wcslen` 130K calls, `_wcsicmp` 90K, `wcscpy` 80K, `wcscat` 43K, `_wcsnicmp` 40K; `_vsnwprintf` internals 1.2-2.4% |
| UT2003 demo (msvcr70) | 70..220 / 220..370 | 4.7% / 6.2% | the same wide-string set |
| UT2004 demo (msvcr71) | 600..1100 | ~5% | `_wcsicmp` 2.77% (of which `_getptd` 2.08%), `wcslen` 0.64, `_wcsnicmp` 0.55, `wcsstr` 0.29, `wcscat` ~0.24, `wcscpy` 0.22 |
| UT2004 demo (msvcr71) | 1100..1600 / 1600..2100 | | `_woutput` (`_vsnwprintf`) 2.8% / 14.5%, with `mbtowc` 5.47% (524K calls) inside it |
| Morrowind (msvcrt) | load | | `sprintf` -> `_output` ~4.4%, `free` 0.78, `strtok` 0.33, `_strnicmp` 0.15 |
| Morrowind (msvcrt) | frame | | `qsort` ~4% (callback), `sprintf` -> `$I10_OUTPUT` ~1% |
| Unreal SE (msvcrt) | 600..900 | | `fread` 13.9%, `rand` 0.2-0.57% |
| Deus Ex (msvcrt) | | | `rand` 0.2-0.26% |
| Warcraft III (msvcrt) | | | `floor` 0.21% |

Icewind Dale, Half-Life, Arcanum, SimGolf and Heroes III link their CRT
statically, so there is no DLL export to bind and they are out of scope.

## Classification

| class | exports | verdict |
|---|---|---|
| PURE | `wcslen`, `wcscpy`, `wcscat`, `wcsstr`, `floor` | overridden |
| PURE, but locale-dependent | `_wcsicmp`, `_wcsnicmp`, `_stricmp` | overridden, deferring to the real export once the locale leaves "C" |
| ERRNO/TLS | `rand` (per-thread `holdrand` in the ptd), `isdigit`/`mbtowc` (locale tables) | not done: needs a ptd layout per CRT build, and each is under 0.6% |
| STATEFUL | `malloc`/`free`/`new`, `fread` and all `FILE*` I/O, `strtok`, `qsort` (guest callback), `setlocale` | not done; they own CRT state the guest also reads |
| printf family | `sprintf`, `_vsnwprintf` (`_output`/`_woutput`) | the biggest single lever (UT2004 14.5%), but a byte-exact formatter is a project of its own. It is a candidate for the same fallback shape: native for the common conversions, the real export for anything else. |

### The `_getptd` question

`_getptd` (msvcr70 `0x7c00137f`, msvcr71 `sub_7c349636`) is 0.6-0.8% of block
entries (self) in UT2003 and 2.08% in UT2004. It is
`GetLastError`/`TlsGetValue`/`SetLastError` around the per-thread data. Its
callers in UT2003's load window were:

| caller | calls |
|---|---|
| `_wcsicmp` | 90,318 |
| `_wcsnicmp` | 40,511 |
| `isdigit` | 12,431 |
| `rand` | 4,985 |
| `mbtowc` | 3,734 |

All of them came through `core.dll` wrappers. VC7's `_wcsicmp` fetches the ptd
only to compare `ptd->ptlocinfo` with the global locale and to test
`lc_handle[LC_CTYPE]`. So overriding the two case-folding compares removes
about 88% of UT2003's `_getptd` traffic without touching `_getptd` itself.

## Binding

`$patch_caller_iat` in `src/08b-dll-loader.wat` binds the overrides. After the
older `$native_override_export_api_id` list (`_ftol`, `_stricmp`, `ceil`,
`sqrt`, `sin`, `pow`, `_CIpow`, which have no way back), an import is checked
against `$crt_override_api_id` in `src/09a6-handlers-crt.wat` when **both**
of these hold:

- the target DLL is `msvcrt.dll`, `msvcr70.dll` or `msvcr71.dll`;
- the export resolves in that DLL.

For such an import:

- The import is bound to an API thunk, and the authentic export's address is
  recorded against the thunk index in the `$CRT_OVERRIDE_TABLE` region: a
  count, a locale flag, then 127 `[thunk index, export VA]` pairs. UT2003 uses
  11.
- If the table is full, the import binds to the real export instead.

Only name imports resolved at load time are bound. A `GetProcAddress` lookup
still gets the real export.

A handler that cannot be exact calls `$crt_fallback`. That sets `EIP` to the
recorded export and raises `$handler_set_eip`, which is the same redirect a
callback-driven handler (`qsort`) uses. It leaves `ESP` and every register as
the caller set them: the return address is still at `[ESP]` and the cdecl
arguments are still above it. So the authentic code runs as if the thunk had
never been there. `get_crt_fallback_count` counts these redirects.

## What "exact" means per export

All of these handlers are cdecl: they pop only the return address. They read
and write guest memory one code unit at a time through `$gl16`/`$gs16`, so a
string that crosses a sparse guest page boundary is handled the same way as
one that does not.

- **`wcslen`**: counts code units up to the NUL. It has no length cap; the
  handler it replaced stopped at 32768.
- **`wcscpy` / `wcscat`**: one forward code-unit copy through the terminator,
  as the authentic loop does, so an overlapping destination ends up
  byte-identical. Both return `dst`.
- **`wcsstr`**: the MS scan. The builds disagree on exactly one input. VC6 has
  no empty-needle test, so its loop never runs on an empty haystack and
  `wcsstr(L"", L"")` returns NULL; VC7 returns the haystack. The unit test
  found this, and that one input goes to the real export.
- **`_wcsicmp` / `_wcsnicmp`**: the C-locale path (`__ascii_towlower`). It
  folds `A`-`Z` only and returns the difference of the folded units. A count
  of 0 returns 0 without reading either string.
- **`floor`**: computes `f64.floor` and pushes it on the x87 stack. It sets
  C0/C3 exactly as the authentic `frndint` + `fcomp` leaves them (C0 for
  `r < x`, C3 for equal) and restores the caller's control word, since
  `_ctrlfp` saves and restores it. Two cases defer to the real export:
  - a NaN or infinity, which takes the `_handle_qnan1`/`_except1` paths;
  - an inexact result while the caller has the precision exception unmasked,
    which the real code reports through `_except1` (it raises
    `STATUS_FLOAT_INEXACT_RESULT`).
- **Locale.** `setlocale`/`_wsetlocale` imported from the same DLLs are bound
  too. Any call with a locale other than NULL (a query) or `"C"` sets the
  sticky flag, and then the real `setlocale` runs. While the flag is set,
  `_wcsicmp` and `_wcsnicmp` always defer. The flag is never cleared: going
  back to `"C"` is rare and deferring is always correct.

The older `_stricmp` override (Morrowind) is bound through
`$native_override_export_api_id`, not the list above, but when the import
comes from a real MSVCRT/MSVCR7x its authentic export is now recorded in the
same table (`$crt_native_override_defers`), and the handler defers while the
locale flag is set, exactly as `_wcsicmp` does. Bound over anything else (no
real CRT loaded) it has nothing to defer to and stays on the C-locale path.
It returns -1/0/1, which is what the C-locale path of all three builds
returns (`sbb eax,eax` / `sbb eax,-1`); until 2026-09-29 it returned the
folded byte difference, which matched only in sign.

## Tests

`test/test-crt-native-overrides.js` loads each real CRT for real, with
DllMain. It binds a synthetic caller's imports through the production
`$patch_caller_iat`, then runs each of 124 cases twice through the
interpreter:

- once into the authentic export;
- once into the thunk.

Each case compares EAX, the caller's `ESP` after the return (cdecl), every
byte of a 12KB arena and, for `floor`, the x87 result bits, status word, TOP
and control word. The cases cover:

- empty strings, case folding, non-ASCII and `0xFFFF` units;
- counts of 0, 1, 2, 5 and `0xFFFFFFFF`;
- overlapping `wcscpy`/`wcscat`, every `wcsstr` return shape and a 40000-unit
  `wcslen`;
- strings straddling a guest page;
- ±0, subnormals, values around 2^52, NaN/±inf and an unmasked precision
  exception for `floor`;
- a `setlocale("English")` that must send case-folding to the authentic code
  while `wcslen` stays native.

It passes on VC6 `msvcrt.dll`, UT2003's `msvcr70.dll` and UT2004's
`msvcr71.dll`. The DLLs are corpus binaries, so `CRT_BINARIES=<test/binaries
dir>` points a checkout without them at a tree that has them; with none
present the test prints SKIP.

## Measurements

All of this is UT2003 demo (msvcr70) on box2 (4 cores, load under 1). The
common flags were:

```
--app=ut2003_demo --d3d9-renderer=software --d3d9-programmable
--batch-size=200000 --quiet-api --quiet-blocks
```

Each arm was built from main 8e126341; the "on" arm adds this change. Runs of
one build are deterministic: two runs give the same frame and the same
render-request count.

### Why a fixed batch count is the wrong unit here

A batch is a budget of blocks. A native CRT call retires no blocks, so the
candidate does more app work per batch. At 520 batches:

| arm | software D3D render requests | API calls | main-thread CPU |
|---|---|---|---|
| off / off2 | 170 / 170 | 1.13M | 10.60s / 10.59s |
| on / on2 | 199 / 199 | 1.48M | 10.42s / 10.62s |

The candidate gets about 17% further in the same main-thread CPU. The process
total goes up (222s against 258s of user time), but that is the software render
worker drawing 29 more frames at about 1.5s each. It is not the interpreter.

### Fixed work: the 170th render request

Each arm ran under `--control --frozen` and was stepped until
`ctx.renderParkStats.waits` reached 170. Main-thread CPU (utime+stime of the
node main thread from `/proc`) was read at that point.

| arm | main-thread CPU | batches needed | `get_crt_fallback_count` |
|---|---|---|---|
| off | 12.06s | 520 | — |
| off2 | 10.91s | 520 | — |
| on | 10.68s | 491 | 52 |
| on2 | 10.37s | 491 | 52 |

The means are 11.49s against 10.53s, which is -8.4%. **That is inside the null
band**: off and off2 alone differ by 10%. So main-thread CPU for this fixed
work is not resolved on this route. The count data below is the result that
holds up.

The 52 fallbacks are `setlocale` calls, which always run the real export, and
`floor` on non-finite input. The locale flag stayed clear; if it had been set,
every `_wcsicmp` (hundreds of calls per window) would have been a fallback too.

**The frames are not byte-identical, and they are not expected to be.** Both
arms show the same main menu with the same highlighted item. They differ in
3,108 pixels (0.34%), all in one 125x84 box around the spinning "U" logo.
The headless clock is `batch * 200ms`, and the candidate reaches request 170
29 batches (5.8 guest seconds) earlier. So the logo is at a different angle.
This is the batch-clock effect described in `CLAUDE.md`, not a rendering
difference. The unit test is what establishes exactness.

### Block-entry share

`--handler-hist --handler-hist-thread=0,0,0 --edge-hist` over batches
370..520, in three windows of 50 batches, then `tools/crt-hot-exports.js`. This
gives msvcr70's share of all block entries, threaded plus uop:

| window | off | on |
|---|---|---|
| 370..420 | 5.89% | 5.58% |
| 420..470 | 11.82% | 1.37% |
| 470..520 | 14.66% | 1.35% |

Read the last two rows. The first window is not the same phase in both arms,
because the candidate is ahead. It is in `_vsnwprintf`, while the baseline is
still in a `rand` loop. In the baseline's last window:

- `floor` alone is 13.51% inclusive: 50,700 calls, each running `_ctrlfp`,
  `frndint` and the `_fpclass` helpers (`sub_7c0363b7`, `sub_7c034d89`,
  `sub_7c0366a8`).
- The wide-string overrides together are about 0.1%.

In the candidate, none of it is left. What remains of msvcr70 is:

- `_vsnwprintf`, 0.8% (602 calls);
- `mbtowc` under it, 0.4%;
- `memmove`, 0.12%.

So in this window of UT2003's load, `floor` was the lever and the wide-string
set was not. In the earlier census windows (the table at the top), the
wide-string calls were far more frequent. Which export dominates depends on
the phase.

### Verdict

- Block entries: msvcr70 went from 12-15% of UT2003's load to about 1.4%.
  It is exact by construction, and the unit test pins all 124 cases on three
  CRT builds.
- App progress per unit of main-thread CPU at a fixed batch count: +17%.
- Main-thread CPU for a fixed render count: -8%. This is **not resolved**
  against a 10% null band, so do not quote it as a win.
- UT2004, measured 2026-09-29 on box2 over batches 600..1100 (block entries,
  `--handler-hist`, same flags as the UT2003 run). The two arms are
  `fd79d3a5^` (before) and 95b1b8c9 (after):

  | | msvcr71 share | msvcr71 entries | all entries | core.dll entries |
  |---|---|---|---|---|
  | before | 16.1% | 6.15M | 38.16M | 21.0M |
  | after | 6.9% | 2.66M | 38.63M | 25.0M |

  msvcr71 lost 3.5M entries in the window, and core.dll did 19% more work in
  the same batches. That is more than the ~4.7% the earlier census predicted,
  because this window's overridden calls are heavier than that census saw.
  What is left is `_woutput`/`swprintf` → `write_char` (`0x7c36c942`) →
  `_fputwc_lk` (`0x7c36b790`) → `wctomb`, none of which is overridden.
- Morrowind and Unreal SE spend their CRT time in `sprintf`, `qsort` and
  `fread`, none of which is overridden, so no change is expected there.
