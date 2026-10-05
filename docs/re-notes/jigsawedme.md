# JigSawedME 1.3 (VB6)

Registry id `jigssawme` (`lib/apps.js`). A Visual Basic 6 jigsaw game by Michael D. Cook:
`JigSawedME.exe` plus `msvbvm60.dll`, the `LDMinMax6.ocx` control (its CLSID is registered through
the app's `startupRegistry`) and `piecelock.wav`. It uses DirectX7-for-VB (`IDirectX7`,
`IVBDirectDraw7`, `IVBDirectSound`), which is emulated entirely in WAT.

## Module bases (headless run, 2026-09-30)

| module | runtime base | origBase | delta |
|---|---|---|---|
| JigSawedME.exe | 0x00400000 | 0x00400000 | 0 |
| msvbvm60.dll | 0x00541000 | 0x66000000 | -0x65abf000 |
| oleaut32.dll | 0x00793000 | 0x65340000 | |
| ldminmax6.ocx | 0x00925000 | | |

Use `msvbvm60+0x660xxxxx` in `--trace-at`/`--count`/`--break` rather than computing runtime VAs by hand.

## Headless command

```
timeout -k 10 90 node test/run.js --app=jigssawme --max-batches=4000 --max-seconds=80 \
  --quiet-api --no-close --png=/tmp/jig.png
```

It reaches the main window (caption "JigSawedME", menu File/View/Options/Help, grey client area
with no puzzle loaded) and goes idle in msvbvm60's message loop. The stuck detector then ends the run
after about 450 batches (`STUCK at EIP=0x0055e65b`), which is the normal idle case.

## Fixed: "Run-time error '5': Invalid procedure call or argument" at startup

The chain:

1. The exe reads an `App` version-string property (a vtable call at `[edx+0xf8]` around `0x42bee0`)
   and passes the resulting BSTR as the *appname* to `GetSetting(appname, "Settings", "Play Sounds", default)`
   through the import at `[0x4011ac]` (return address `0x0042bf63`).
2. msvbvm60 builds that property from the version resource: `GetFileVersionInfoA("C:\JigSawedME.exe")`,
   then `VerQueryValueA("\VarFileInfo\Translation")`, then
   `VerQueryValueA("\StringFileInfo\040904b0\<Name>")` (around `msvbvm60+0x6607f187`/`0x6607f1cc`).
3. The VB6 resource compiler writes a text node's `wValueLength` in **bytes**, not UTF-16 units. For example,
   ProductName is `38 00 16 00 01 00` followed by "JigSawedME\0", which is 22 bytes. Our
   `$version_value_offset` doubled the count for `wType 1`, found that it ran past `wLength`, and rejected
   the node. `VerQueryValueA` returned FALSE and the property came back as an empty (NULL) BSTR.
4. `rtcGetSetting` (`msvbvm60+0x660f69bc`) checks each string argument with `0x660f6aeb`
   (`test eax,eax / mov eax,[eax-4] / shr eax,1 / ja ok / push 5 / call 0x660cddb3`).
   `0x660cddb3` is the generic runtime raise: it builds HRESULT `0x800a0005` and raises exception `0xc000008f`.
   VB then shows the MsgBox through **MessageBoxIndirectA** (not MessageBoxA, so `--break-api=MessageBoxA`
   never fires).

The fix is in `src/09a1-comctl-handlers.wat`. Windows bounds a value by its node rather than by `wValueLength`.
A text node's value is now clamped to the node end (`$version_value_bytes`), and that clamp is also used to
step to the first child. `VerQueryValueA/W` report the length through the first NUL, capped at what fits
in the node. `test/test-file-version-info.js` covers a byte-count tree.

`tools/pe-version.js` has the same doubling assumption and prints garbled strings for this exe. It is a
diagnostic, and it has not been fixed.

## Ruled out

- The warning "ole32.dll is loaded as a real PE but is not on disk" is **benign**. `ole32.dll` is listed in
  `APP_LOCAL_DLLS` (`lib/dll-registry.js`, for Explorer). When a dependency asks for it and the file is
  missing, its imports go to the WAT stubs, as they do for every VB6 app (Rodent2000 is the same). It has
  nothing to do with error 5.
- `LoadLibraryA("SXS.DLL")` returns the exe base with `GetLastError=2`, and `GetProcAddress` then returns 0.
  msvbvm60 copes with this, so it is not a blocker, but the return value is odd if it ever matters.
