# Video for Windows support — design

Status: implemented, 2026-09-28. See "What exists today". This file began as
the design, written before any of the layers existed.

## tl;dr

```
                           GUEST APPS
 ┌──────────────┬───────────────┬─────────────────┬──────────────┐
 │ direct ICM   │ AVIFile       │ MCI avivideo    │ Animate ctl  │
 │ War Wind     │ Dark Colony   │ HL Uplink       │ SysAnimate32 │
 │ Dark Colony  │ TDR2000, AVS  │ Civ2 (MCIWnd)   │ VB6 samples, │
 │ Civ2, MW3,   │ Civ2 (Win16,  │ AoE1/2 (MCIWnd) │ shell copy   │
 │ MCM, DbtS    │  exists)      │                 │ progress     │
 └──────┬───────┴───────┬───────┴────────┬────────┴──────┬───────┘
        │               │                │               │
        │       ┌───────▼────────────────▼───────────────▼──────┐
        │       │ AVI CORE (WAT, one parser for Win16 + Win32)  │
        │       │ RIFF 'AVI ' → avih, strl{strh,strf,strn},     │
        │       │ movi{##dc ##db ##wb ##pc, LIST rec}, idx1,    │
        │       │ AVIX extents; keyframe flags; sample<->time   │
        │       └───────┬──────────────────────────────┬────────┘
        │               │ video chunk                  │ audio chunk
 ┌──────▼───────────────▼─────┐               ┌────────▼──────────┐
 │ ICM LAYER (WAT)            │               │ AUDIO             │
 │ ICOpen ICLocate ICClose    │               │ PCM → waveOut mix │
 │ ICInfo ICGetInfo           │               │ ADPCM → ACM later │
 │ ICSendMessage ICDecompress │               └───────────────────┘
 │ + Win16 MSVIDEO ordinals   │
 └──────┬─────────────────────┘
        │ switch on fourcc
 ┌──────▼─────────────────────────────────────────────────────────┐
 │ CODECS (WAT): compressed frame in → DIB out (8/16/24/32 bpp)   │
 │  BI_RGB  copy / flip / 555                     done (09a7e)    │
 │  BI_RLE8 runs + delta, retained plane          done (09a7e)    │
 │  cvid    Cinepak: strips, V1/V4 2x2 codebooks  done (09a7e)    │
 │  CRAM    MS Video 1: 4x4 blocks, 1/2/8 colours done (09a7e)    │
 │  anything else: an INSTALLED DRIVER, as on Windows (done 09a7g)│
 │    SYSTEM.INI [drivers32] VIDC.XXXX → LoadLibrary → DriverProc │
 │    run as guest x86 — Civ2's IV41 through Intel's ir41_32.dll  │
 └──────┬─────────────────────────────────────────────────────────┘
        ▼
  DrawDib / StretchDIBits (exist) → window surface
  MCI player clock = guest time, audio is the master clock

 NOT OURS: Smacker (smackw32.dll) and Bink (binkw32.dll) ship with the
 game and already run as x86. Deferred: DirectShow/quartz, QuickTime.

 ORDER: ICM + BI_RGB/RLE8/Cinepak → AVIFIL32 → MCI avivideo
        → Animate control → MS Video 1 → installable drivers (Indeo 4)
```

## What the apps actually do

Measured 2026-09-28: a static scan of all 2,523 PEs under `test/binaries`
for the VfW entry points, ffprobe over all 145 `.avi` files there, then
`test/run.js --trace-fs --trace-api=<video APIs>` for 40 s per app.
The CD-only titles came from their ISOs.

| App | Movies | Codec | API path | What happens today |
|---|---|---|---|---|
| War Wind | 63 on CD: `OPEN\LOGOS`, `OPEN\WWOPEN`, 15 briefings per race | Cinepak 320×240 @15, PCM 22 kHz mono | parses the AVI itself; `ICOpen('vidc','cvid',ICMODE_DECOMPRESS)` then `ICSendMessage` `0x400C` BEGIN, `0x401E` GET_PALETTE, `0x403C` DECOMPRESSEX_BEGIN, `0x403E` DECOMPRESSEX; asks for **8 bpp BI_RGB, 256 colours** | `ICOpen` → 0, movies skipped |
| Dark Colony demo | `AVI\intro` (2233 frames) + 4 scenes | Cinepak 320×180 @15, PCM 11 kHz | AVIFIL32 `AVIStreamOpenFromFileA/InfoA/Length/ReadFormat/Read/Release`, then `ICLocate('vidc', …)` + `ICDecompress`, asks for **24 bpp BI_RGB** | **crashes**: `UNIMPLEMENTED API: AVIStreamOpenFromFileA` |
| Half-Life Uplink | `media\intro.avi` (54 s), `uplink.avi` | RLE8 320×240 @25 + PCM stereo; RLE8 640×100 | `mciSendString("open media\intro.avi type AVIVideo alias sierravideo parent H style child")`, `window … handle H`, `put … destination at 0 0 320 240`, `break … on 27`, `play … wait`, `close` | open returns 0 and `play wait` returns at once — **silently skipped** (see below) |
| Civilization II (Win16 + MGE) | 119 advisor / wonder movies | Indeo 4 (IV41) | Win16: AVIFILE + MSVIDEO ordinals; MGE: AVIFIL32 + `ICLocate/ICDecompress` + `MCIWndCreateA` | Without Indeo installed, `ICLocate` finds no codec and the movie is skipped (correct Windows behaviour). After the Indeo installer on its CD has run, Win32 `ir41_32.dll` decodes through the installable-driver path. |
| MechWarrior 3 demo | probes `video\intro.avi` | — | AVIFIL32 + ICM | file is not in the demo; nothing to play |
| VB6 working model | 26 sample AVIs | RLE8, BI_RGB 8/16/24, one Cinepak | Animate control / MCI | not exercised |
| War Wind II | `WW2\DATA\VIDS\CINE\*.SMK` | Smacker | `smackw32.dll` (guest code) | not this design |
| SimGolf | `flics\*.bik` | Bink | `binkw32.dll` (guest code) | not this design |

The 40 s runs of AoE1, AoE2, MCM, Moorhuhn 2, TetriNET, SC2K Net and the
Win98 tour/welcome made MCI calls for CD audio and MIDI only; their video
APIs are imported but not reached in that window.

## What exists today

Updated 2026-09-28. Phases 0-5 have landed. Indeo 4 plays through the real
Intel driver, with no WAT Indeo decoder (see "Installable codec drivers").

| Piece | Where | State |
|---|---|---|
| Decoders: BI_RGB, RLE8, Cinepak, MS Video 1 (8/16 bpp) | `src/09a7e-video-codecs.wat` | bit-exact against ffmpeg (`tools/avi-player/`, `test/test-video-cram.js`) |
| AVI reader | `src/09a7f-video-avi.wat` | RIFF/idx1/indx, VFS file or guest memory (`$avi_open_memory`) |
| ICM (`ICOpen`/`ICDecompress`/`ICGetInfo`/…) | `src/09a7g-video-icm.wat` | built-in codecs by fourcc; any other fourcc goes to an installed driver's DriverProc, run as guest x86 (`test/test-icm-installable-driver.js`, `test/test-icm-indeo4-candidate.js`) |
| MCI `avivideo` | `src/09a7h-video-mciavi.wat` | string interface, `wait` parks the thunk, `notify`, PCM audio; Half-Life Uplink (`test/test-mciavi-uplink-candidate.js`) |
| MCIWnd (`MCIWndCreateA`) | `src/09a7i-video-mciwnd.wat` | message layer over the MCI device, wndproc `0xFFFF0006` (`test/test-mciwnd.js`) |
| SysAnimate32 | `src/09c3-wndprocs6-animate.wat` | RLE8/raw, resource or file, WM_TIMER or host-clock playback; HyperTerminal's globe (`test/test-animate-control.js`) |
| Win16 AVIFILE / MSVIDEO | `src/09e-win16-api.wat` | unchanged: own header parse; `ICLocate` → 0 |
| DrawDib* | `src/09a4-handlers-gdi.wat` | still uncompressed only |
| Standalone player | `tools/avi-player/` | every corpus movie, the same WAT decoders compiled on their own |

Still missing:
- **Civ2 MGE in its own movie route.** Its 59 IV41 movies decode once the
  Indeo installer from its disc has run (`docs/re-notes/civilization-2-mge.md`).
  Only Uplink's MCI player has been driven through them headless. We do not
  ship Intel's DLL.
- Indeo 3/5 (`ir32_32.dll`, `ir50_32.dll`) use the same path and are untested.
- The Win16 `IR41.DL_` driver: Win16 MSVIDEO `ICLocate` still returns 0.
- `ICInfo` enumeration (a numeric `fccHandler`) lists only the built-in codecs.
- The `mciSendCommand` binary interface to the avivideo device.
- Palette-change chunks in MCI playback, `play repeat`, and the MCIWnd
  playbar and menu.
- DrawDib with compressed input.

## API surfaces

### 1. ICM — the codec manager (MSVFW32.DLL; Win16 MSVIDEO.DLL)

The foundation. Everything else reaches codecs through it.

| Export | Behaviour |
|---|---|
| `ICOpen(fccType, fccHandler, wMode)` | `fccType` 'vidc' (case-insensitive), handler fourcc → a codec in the table; returns an HIC or 0. Modes: `ICMODE_DECOMPRESS` 2, `ICMODE_FASTDECOMPRESS` 3, `ICMODE_QUERY` 4; `ICMODE_COMPRESS` 1 and `ICMODE_DRAW` 8 → 0 (no compressors, no draw handlers). |
| `ICLocate(fccType, fccHandler, lpbiIn, lpbiOut, wFlags)` | Try the named handler, then every codec, asking `ICM_DECOMPRESS_QUERY` (or DECOMPRESSEX_QUERY) against `lpbiIn`/`lpbiOut`. `lpbiOut` may be NULL. |
| `ICSendMessage(hic, msg, dw1, dw2)` | The dispatcher below. |
| `ICDecompress(hic, dwFlags, lpbiFormat, lpData, lpbi, lpBits)` | A real export that builds an ICDECOMPRESS and sends `ICM_DECOMPRESS`. |
| `ICInfo(fccType, fccHandler, lpicinfo)`, `ICGetInfo(hic, lpicinfo, cb)` | Fill ICINFO (fccType, fccHandler, flags, name `"Cinepak"`, description, driver `"iccvid.dll"`). `ICInfo` with a numeric handler enumerates. |
| `ICClose(hic)` | Free the record. |
| `ICImageDecompress`, `ICGetDisplayFormat` | Helpers over the above; add when an app calls them. |

Most of the vfw.h "functions" (`ICDecompressBegin`, `ICDecompressGetFormat`,
`ICDecompressEx`…) are macros over `ICSendMessage`, which is why War Wind
imports only `ICOpen`, `ICSendMessage` and `ICClose`.

Messages (`ICM_USER` = 0x4000):

| Msg | Name | dw1, dw2 | Codec's job |
|---|---|---|---|
| 0x400A | DECOMPRESS_GET_FORMAT | lpbiIn, lpbiOut | lpbiOut NULL → return the size; else write the preferred output header (native depth, same w/h) |
| 0x400B | DECOMPRESS_QUERY | lpbiIn, lpbiOut | ICERR_OK if this codec decodes lpbiIn into lpbiOut (lpbiOut may be NULL), else ICERR_BADFORMAT |
| 0x400C | DECOMPRESS_BEGIN | lpbiIn, lpbiOut | validate, allocate per-stream state (codebooks, retained frame), pick the output converter |
| 0x400D | DECOMPRESS | &ICDECOMPRESS, size | decode one frame into lpOutput; honour ICDECOMPRESS_HURRYUP (decode but skip the output), NOTKEYFRAME, NULLFRAME, PREROLL |
| 0x400E | DECOMPRESS_END | — | drop the state |
| 0x401D | DECOMPRESS_SET_PALETTE | lpbiPal | 8-bit output: use the caller's palette |
| 0x401E | DECOMPRESS_GET_PALETTE | lpbiIn, lpbiOut | 8-bit output: write the codec's palette after lpbiOut, set biClrUsed |
| 0x403C..0x403F | DECOMPRESSEX_BEGIN / QUERY / DECOMPRESSEX / END | &ICDECOMPRESSEX, size | the same with src/dst rectangles (xDst,yDst,dxDst,dyDst,xSrc,ySrc,dxSrc,dySrc) and a stretch; ICERR_BADFORMAT for a stretch we do not do |
| 0x5002 | GETINFO | lpicinfo, cb | as ICGetInfo |
| DRV_* | open/close/load/free/query-configure | | answer as a driver that has no configure/about |

Structs: `ICDECOMPRESS { dwFlags, lpbiInput, lpInput, lpbiOutput, lpOutput, ckid }`;
`ICDECOMPRESSEX { dwFlags, lpbiSrc, lpSrc, lpbiDst, lpDst, xDst, yDst, dxDst, dyDst, xSrc, ySrc, dxSrc, dySrc }`.
Guest buffers are guest pointers; decode through `$guest_span_in` or
per-row translation, never through one `$g2w` of the whole frame (a 320×240×3
output spans many guest pages; see `tools/check-guest-span.js`).

HIC record (emulator-private table, generation-tagged handle like the
SetupDi sets): `{codec id, mode, state ptr, in format copy, out format copy,
palette[256]}`. Codec state lives in an emulator arena: a Cinepak context is
32 strips × (2 × 256 × 12 bytes of codebook) plus the retained RGB frame.

#### Installable codec drivers (the guest DriverProc backend)

A fourcc that no built-in decoder claims is handled as Windows handles it: by
the installed driver DLL, running as ordinary guest x86. There is no emulator
copy of the codec, which is how Civ2 MGE's Indeo 4 movies play through
Intel's own `ir41_32.dll`. All of it is in `src/09a7g-video-icm.wat`, from
"installable drivers" onwards.

- **Lookup** (`$icm_drv_lookup`): SYSTEM.INI `[drivers32] VIDC.XXXX=file.dll`,
  and if that is empty, `HKLM\Software\Microsoft\Windows NT\CurrentVersion\Drivers32`.
  A bare file name is searched for as-is and then in the system directory.
  SYSTEM.INI is what counts on Win9x. The Indeo installer's own script writes
  its ICM registry keys under **HKCR**\System\CurrentControlSet\… (the guest
  really passes `0x80000000`), so no Windows would find them there either.
- **Load** (`$icm_drv_get`): if the module is not mapped yet, the handler asks
  the host for it through the existing LoadLibrary yield (reason 5). It then
  either parks the calling API on its import thunk (`$icm_park_load`, used by
  `ICOpen`/`ICLocate`, which run again after the load), or rides on the current
  call without parking (`$icm_request_load`, used by the MCI device, which
  opens its codec at the first frame). In both cases `take_loadlib_keep_regs`
  tells `lib/process-boot.js` and `lib/guest-worker.js` to keep the guest's
  EAX/ECX/EDX rather than store a module handle. Three failed tries mean the
  driver is not there. Once mapped, the loader sends `DRV_LOAD` (which must
  return nonzero) and then `DRV_ENABLE`.
- **Open**: `DRV_OPEN` with a real 36-byte ICOPEN {size, 'vidc', fccHandler,
  version, mode}. The driver's return value becomes the instance id carried
  by every later message. 0 means the driver refused.
- **Messages** (`$icm_guest_send`): every ICM message on that HIC is forwarded
  as-is. The guest's own buffers stay guest pointers, so no translation is
  needed.
- **Close** (`$icm_close_rec`): `DRV_CLOSE`, then `DRV_DISABLE` + `DRV_FREE`
  when the last HIC on that driver closes. The module stays mapped.
- **`ICInfo`** for an installed fourcc is answered from the registration
  alone, without loading the DLL, as Windows does (`$icm_guest_info`).
- **`DefDriverProc`** (winmm, api 3743) handles the messages a driver passes
  through. **`LocalHandle`** (api 3744) was added because ir41_32 calls it on
  the way out.

**The nested call** (`$icm_drv_call`) is the `$edit_stream_call` pattern. It
saves the interrupted x86 context, pushes the five stdcall arguments and
`$sync_msg_ret_thunk`, and runs `$run(1000000)` until EIP reaches 0, for at
most 64 rounds (log marker `0xCA1CD000`). It must also save and restore
`$current_thunk_eip`: every API the driver calls re-points it, and a parked
`play wait` that then parks on the *driver's* last import runs the guest into
address 0.

**The MCI device** (`src/09a7h-video-mciavi.wat`): `$mciavi_open` falls back to
`$icm_locate_guest` when no built-in codec matches. `$mciavi_codec_begin` asks
for 32 bpp first and steps down to 24 and 16, because Indeo refuses 32. The
painter reads whatever depth was accepted. MCIWnd plays through this device,
so it is covered too.

**Two emulator bugs the real codec exposed** (both fixed):
- **Rotate flags.** ROL/ROR/RCL/RCR set ZF/SF from their own result. On x86
  they write only CF and OF (`$set_flags_rotate` in `src/03-registers.wat`,
  `src/05-alu.wat`). Indeo's runtime-generated VLC reader does
  `cmp al,0x10 / ror eax,0x10 / jz`, so the wrong ZF looped it forever.
  `test/test-shift-equivalence.js` now checks preserved ZF/SF and the OF
  formulas. The uop compiler (`src/07e`) declines rotates, because its flag
  record cannot express "unchanged".
- `$current_thunk_eip` across the nested call, above.

### 2. AVIFile (AVIFIL32.DLL; Win16 AVIFILE.DLL)

Dark Colony needs `AVIFileInit`, `AVIFileExit`, `AVIStreamOpenFromFileA`,
`AVIStreamInfoA`, `AVIStreamLength`, `AVIStreamReadFormat`, `AVIStreamRead`,
`AVIStreamRelease`. Round it out with `AVIFileOpenA/W`, `AVIFileGetStream`,
`AVIFileInfo`, `AVIFileRelease`, `AVIStreamStart`, `AVIStreamSampleToTime`,
`AVIStreamTimeToSample`, `AVIStreamFindSample`, and
`AVIStreamGetFrameOpen/GetFrame/GetFrameClose` (Winamp AVS), which is a thin
loop over the ICM layer.

A `PAVIFILE`/`PAVISTREAM` is a COM object (`IAVIFile`, `IAVIStream`,
`IGetFrame`); apps may call through the vtable, so build them the way the DX
COM objects are built (vtable in the thunk zone, `0xC0DE0000|api_id`).

The Win16 AVIFILE parser already exists. Lift its RIFF walk into a shared
**AVI core** that both front doors call, rather than writing a second one.
The core owns: the header lists, a per-stream sample index (from idx1 when
present, else a movi scan), keyframe flags, `##pc` palette changes, and
OpenDML `AVIX` extents. `AVIStreamRead` returns the raw chunk bytes; nothing
in AVIFile decodes.

### 3. MCI avivideo (MCIAVI) and MCIWnd

The player that apps without their own decode loop use. Commands in the
traced apps: `open <file> type AVIVideo alias A parent H style child`,
`window A handle H [state …]`, `put A destination at x y w h`,
`seek A to start`, `break A on <vk>`, `play A [wait|notify]`, `stop`,
`close`, and `status A length/position/mode`, `where A destination`.
`mciSendCommand` carries the same through MCI_OPEN/PLAY/WINDOW/PUT/… with
`MCI_DGV_*` structs.

Design:
- A device record per open: AVI core handle, video and audio stream, HIC,
  output DIB, target hwnd + destination rect, position, mode, notify hwnd,
  break key.
- The device lives in WAT, not in `lib/host-audio.js`: it decodes, owns a
  window and paints. The JS MCI parser forwards `avivideo`/`.avi` opens to
  it, the way it already hands `cdaudio` to the disc.
- Painting: decode into the device DIB, then the same path as StretchDIBits
  onto the target window (or a child window it created under `parent`, class
  `AVIWnd32`).
- `play … wait` blocks the guest call. Park the calling thread like a
  blocking wait; each batch the device advances to the frame the guest clock
  says, paints, and resumes the guest with 0 at the end, on `stop`, or when
  the `break` key is pressed (Uplink passes VK_ESCAPE, 27). `play … notify`
  returns at once and posts `MM_MCINOTIFY` (0x3B9) to the callback hwnd when
  done.
- Audio: the PCM stream goes into the existing waveOut mixer as one voice
  (a device-owned waveOut), and its played-sample position is the master
  clock. Video frames are chosen from it; a late frame is decoded without
  being painted (Cinepak and RLE8 inter frames must still be decoded in
  order).
- `MCIWndCreateA/W` (MSVFW32) is a window class (`MCIWndClass`) wrapping the
  same device, driven by `MCIWNDM_*` messages; add it after the string
  interface works, for Civ2 MGE and AoE.

### 4. The Animate control (COMCTL32 `SysAnimate32`)

`ACM_OPENA/W` (WM_USER+100/+103), `ACM_PLAY` (+101, from/to/repeat),
`ACM_STOP` (+102), notifications `ACN_START`/`ACN_STOP`. It plays silent
RLE8 or BI_RGB AVIs from a resource or a file, looped. That covers the VB6
sample AVIs and the shell file-operation progress dialogs, which load their
animations from shell32 resources. A timer-driven wndproc over the AVI core
plus the RLE8/BI_RGB converters; no ICM needed.

### 5. DrawDib with compressed input

`DrawDibBegin`/`DrawDibDraw` accept a compressed `lpbi` and decompress
through ICM themselves. Once ICM exists, a compressed format opens an HIC in
the DDIB record and decodes into its buffer before the existing StretchDIBits
step, which also makes `DDF_UPDATE` possible.

## Formats and algorithms

### Container: RIFF AVI

`RIFF 'AVI ' { LIST 'hdrl' { avih; LIST 'strl' { strh; strf; strn? }… };
LIST 'movi' { chunks | LIST 'rec ' { chunks } }; idx1? }`, optionally
followed by `RIFF 'AVIX'` extents (OpenDML). Chunks are padded to even
sizes. A chunk id is two stream digits plus `dc` (compressed video), `db`
(uncompressed video), `wb` (audio) or `pc` (palette change). `strh` carries
`dwScale`/`dwRate` (fps = rate/scale) and `dwLength`; `strf` is a
BITMAPINFOHEADER plus palette for video, WAVEFORMATEX for audio. `idx1`
entries `{ckid, flags, offset, size}` give keyframes (`AVIIF_KEYFRAME` 0x10);
offsets are relative to the `movi` list (occasionally absolute — detect by
checking the first entry). A zero-length video chunk means "repeat the
previous frame" (WWOPEN has 7 of them).

### BI_RGB (uncompressed)

Rows padded to 4 bytes, bottom-up unless `biHeight < 0`. 8 bpp uses the
`strf` palette (updated by `##pc`), 16 bpp is RGB555, 24 bpp is BGR, 32 bpp
is BGRX. The only work is conversion to the requested output depth.

### BI_RLE8

Byte pairs `(n, c)`: n > 0 is a run of n copies of index c; n = 0 escapes:
0 end of line, 1 end of frame, 2 `dx dy` skip, 3–255 that many literal
bytes padded to a word. In AVI, **delta frames encode only what changed**,
so the index plane must persist between frames and not be cleared; the
`10a` bitmap decoder starts from a fresh plane and needs a "retain" mode.
Output is 8 bpp indices plus palette, or converted through the palette.

### Cinepak ('cvid', Radius/SuperMac, iccvid.dll)

A vector quantiser. Frame = 10-byte header `{flags8, size24, w16, h16,
strips16}` (big-endian throughout), then horizontal strips, each
`{id16 (0x1000 key / 0x1100 inter), size16, y1, x1, y2, x2}` (a zero `y1`
means "relative to the previous strip") containing chunks:

| Chunk | Meaning |
|---|---|
| 0x20 / 0x24 | V4 codebook, full; 6-byte colour / 4-byte grey entries |
| 0x21 / 0x25 | V4 codebook, partial: 32-bit bitmaps select which of 256 entries update |
| 0x22 / 0x26, 0x23 / 0x27 | the same for the V1 codebook |
| 0x30 | intra vectors: per 4×4 block one bit, 1 = V4 (4 indices), 0 = V1 (1 index) |
| 0x31 | inter vectors: a skip bit first (0 = keep the old block), then the V1/V4 bit |
| 0x32 | V1-only vectors: one index per block, no bits |

A codebook entry is a 2×2 block: Y0..Y3 plus signed U and V, converted as
`R = Y + 2V`, `G = Y − U/2 − V` (C truncating division), `B = Y + 2U`,
clamped. V1 blows one entry up to 4×4 (each pixel doubled); V4 tiles four
entries into the 4×4 block (TL, TR, BL, BR). Codebooks persist per strip
index across frames, and strip i > 0 starts from strip i−1's books unless
frame-flag bit 0 is set. Output: 24/32 bpp directly, RGB555 by truncation.

**8-bit output** (War Wind asks for it): iccvid decodes into a fixed
palette with an ordered dither and hands that palette out on
`DECOMPRESS_GET_PALETTE`. The exact iccvid palette and dither matrix are the
one open fact here. Measure them on the Win2K QEMU 256-colour reference VM
(decode a known frame to 8 bpp with a tiny ICM test program, read back
palette + indices). Until then, use a 6×6×6 cube plus greys in the 236
non-system entries with a 4×4 Bayer dither, and say so in the code.
Palettized Cinepak *sources* (biBitCount 8, codebook entries are indices)
exist but are rare; decline them with ICERR_BADFORMAT until one turns up.

### MS Video 1 ('CRAM'/'MSVC'/'WHAM', msvidc32.dll)

4×4 blocks with a 16-bit flags word each: a skip run, a solid fill, 2 colours
+ a 16-bit mask, or 8 colours (four 2×2 quadrants with 2 colours each). 8 bpp
(palette indices) and 16 bpp (RGB555) variants. Not in the corpus AVIs, but
it is the other codec Win98 shipped, and it is small.

**Done:** `$vid_cram_decode` (8 bpp into the retained index plane, then
`$vid_index_to_bgrx`; 16 bpp straight into the BGRX frame), registered in the
ICM layer for 'CRAM'/'MSVC'/'WHAM' in any case, and in the standalone player.
Bit order, measured against ffmpeg's `msvideo1.c`: flag bit k paints row
k>>2 counted up from the block's bottom, column k&3, set = the first colour of
the pair; eight-colour pairs are bottom-left, bottom-right, top-left,
top-right; a skip counts this block, and a skip count of 0 skips the rest of
the frame. 8 bpp takes eight colours for flag high byte 0x90 and up, 16 bpp
when bit 15 of the first colour is set. `test/test-video-cram.js` checks
hand-built 8 and 16 bpp streams with every block kind against the generator's
own model, against ffmpeg through `verify.js` (bit-exact, including an
ffmpeg-encoded 16 bpp movie), and through ICLocate + ICM_DECOMPRESS. ffmpeg
has no 8 bpp encoder, which is why the 8 bpp fixture is hand-built.

### Indeo 4 ('IV41', Intel ir41_32.dll)

**Not implemented in WAT, and it doesn't need to be.** The game's own Indeo
install supplies `ir41_32.dll`, and it runs behind the installable-driver path
above. Checked against ffmpeg `indeo4` on Civ2's ANARCHY0.AVI: 99.98% of
pixels within 24, max delta 27, which is YUV→RGB rounding
(`test/test-icm-indeo4-candidate.js`). What follows describes the format, for
reference.

Civ2's 119 movies. YVU 4:1:0: three planes, the luma plane optionally split
into 4 wavelet bands (Haar or 5/3), each band divided into tiles →
macroblocks (8×8/16×16) → blocks (4×4/8×8). Per band: an inverse transform
(slant 8×8/4×4, 1-D slants, Haar or none), run-level coefficient coding with
VLCs chosen from 8 static and custom Huffman codebooks plus run/value
remapping tables, per-macroblock quantiser deltas, and half-pel motion
compensation from the previous (or scalable-reference) frame. Frame types:
intra, inter, scalable inter, droppable, null (repeat). An optional
transparency plane. Output YUV → RGB. The reference implementation is
FFmpeg's `indeo4.c` + `ivi.c` + `ivi_dsp.c` with their tables, several
thousand lines of C. It is the largest single item here and only Civ2 needs
it; check license compatibility before porting the tables.

### Audio inside AVIs

Every traced AVI carries PCM (8-bit unsigned or 16-bit signed, mono or
stereo), which needs no codec. IMA ADPCM (0x11) and MS ADPCM (0x02) would go
through ACM (`acmStreamOpen/Convert`), which today refuses every non-PCM
stream. Add those two converters only when a real AVI needs them.

## Where the code goes

| Fragment | Contents |
|---|---|
| `src/09a7e-video-codecs.wat` (**exists**) | The decoders, as pure functions: every parameter is a WASM address, and they use no globals and no imports. `$vid_cvid_decode` keeps a per-strip codebook state block. `$vid_rle8_decode` + `$vid_index_to_bgrx` keep an index plane between frames. `$vid_cram_decode` (MS Video 1) writes that plane at 8 bpp and the frame at 16 bpp. Also `$vid_raw_decode` and `$vid_palette_change`. Output is a top-down 32-bit BGRX frame kept between frames; the ICM layer converts it to the DIB the app asked for. Indeo 4 comes later as `$vid_iv41_*`. |
| `src/09a7f-video-avi.wat` | AVI core: RIFF walk, stream table, sample index, keyframes, palette changes; used by Win32 AVIFIL32, Win16 AVIFILE (moved out of `09e`), MCIAVI and the Animate control |
| `src/09a7g-video-icm.wat` | HIC table, `ICOpen/ICLocate/ICInfo/ICGetInfo/ICSendMessage/ICDecompress/ICClose`, the message switch, output-format conversion (→ 8 dither / 16 / 24 / 32, rectangles for DECOMPRESSEX), and the codec state blocks translated from guest pointers; Win16 MSVIDEO ordinals call into it |
| `src/09a7h-video-mciavi.wat` | the avivideo device, MCIWnd class, `play wait` parking |
| `09a9-comctl32.wat` | `SysAnimate32` wndproc |

Regions: one `region.declare` for the codec-state arena (HIC records, Cinepak
books, retained frames; ~2 MB covers several open streams at 640×480) and a
small one for MCI device records. No new host imports: decoding and painting
are WAT, and audio reuses the waveOut mixer.

## Testing

1. **One implementation, checked against ffmpeg.** The decoders exist only as
   WAT. There is no JS copy to drift from them. `tools/avi-player/codecs-wasm.js`
   compiles `src/09a7e-video-codecs.wat` as a module of its own: the fragment's
   functions plus an exported memory, built with the vendored WATX compiler
   under the build's own options. It works because the fragment is pure. It
   runs in Node through `tools/watx.js` and in the page through the
   `tools/watx-src/` scripts. `node tools/avi-player/verify.js <avi…>`
   compares that module's output with ffmpeg, frame for frame.
   Measured 2026-09-28, all bit-exact with worst channel delta 0:
   - every frame of War Wind's WWOPEN (1898)
   - the first 200 of LOGOS, EA1CH and TH1MS
   - all five Dark Colony movies
   - every frame of Uplink's intro (1344) and of uplink.avi
   - all 19 VB6 samples (Cinepak, RLE8, 8/16/24 bpp)

   Civ2's IV41 is reported as SKIP, since the player has no Indeo decoder.
   Inside the emulator IV41 goes through the guest driver (item 6).
2. **ICM unit test** (`test/test-video-codecs.js`): drive `ICSendMessage`
   inside the full emulator with real frames from those files. Compare the
   guest output buffer with the standalone module's frame: 24 bpp must match
   exactly; 8 bpp is checked against the iccvid palette once that has been
   measured. This test covers the ICM layer's pointer translation and format
   conversion; the decoders themselves are covered by 1.
3. **ICM surface tests**: ICLocate with NULL lpbiOut, GET_FORMAT size probe,
   QUERY refusal of IV41, DECOMPRESSEX rectangles, HURRYUP.
4. **App checks** (headless `--png` at fixed batches): War Wind's LOGOS
   frame, Dark Colony past `AVIStreamOpenFromFileA` into its intro, Uplink's
   intro via MCI (and `break` on ESC ends it), Civ2 still skipping cleanly.
5. **Watching.** `tools/avi-player/index.html` (serve the repo root with
   `node tools/dev-server.js`, open `/tools/avi-player/`) plays any of the
   corpus movies or a dropped file, with audio, a seek bar, frame stepping and
   the per-frame key/delta, size and decode time. It compiles the same WAT
   fragment in the page. The only JS is the demux, PCM unpacking and the
   BGRX→RGBA copy into the canvas.
6. **Installable drivers.**
   - `test/test-icm-installable-driver.js` builds a tiny driver DLL
     (`xtst32.dll`) and an EXE in JS, and registers the driver in SYSTEM.INI
     through an overlay. It checks `ICInfo`, `ICOpen`, `ICGetInfo`, a private
     message, `DefDriverProc` pass-through and `ICClose`. It also checks the
     exact DriverProc order: LOAD, ENABLE, OPEN, GETINFO, 0x7001, CONFIGURE,
     CLOSE, DISABLE, FREE.
   - `test/test-icm-indeo4-candidate.js` plays ANARCHY0.AVI through Uplink's MCI
     player with the real `ir41_32.dll` and compares the frame with ffmpeg. It
     SKIPs without the DLL. Intel's DLL is never committed: point
     `INDEO_IR41_DLL` at it, or put it in the gitignored
     `test/binaries/candidates/civilization-2-mge-win32/indeo/`.

## Phases

| # | Deliverable | Unlocks |
|---|---|---|
| 0 | MCI: fail `type avivideo` truthfully instead of the silent success | Uplink stops pretending |
| 1 | ICM layer + BI_RGB + RLE8 + Cinepak (24/32/16 and 8-bit dither) | War Wind's 63 movies |
| 2 | AVIFIL32 (Win32) on the shared AVI core; Win16 AVIFILE moved onto it | Dark Colony (crash fixed, intro plays) |
| 3 | MCIAVI device: string + command interface, `wait`/`notify`, audio clock | Half-Life Uplink |
| 4 | Animate control; DrawDib over ICM; MS Video 1 | VB6 samples, shell progress animations |
| 5 | MCIWnd (done); installable drivers, Indeo 4 via the real `ir41_32.dll` (done) | Civ2 advisor/wonder movies |

## Out of scope

- **Smacker / Bink.** The game ships the vendor DLL (`smackw32.dll`,
  `binkw32.dll`) and it runs as x86 like any other code; War Wind II's cutscenes
  and SimGolf's `.bik` intro use this path.
- **DirectShow / ActiveMovie** (`quartz.dll`, MPEG-1), **QuickTime**, and
  **compression** (`ICCompress`, only VirtualDub asks) — each is a separate
  design if an app needs it.
- **WebCodecs / `<video>`.** Neither decodes Cinepak, RLE8 or Indeo, and a
  browser-only decoder would split the CLI from the browser. The decoders are
  WAT so both hosts run the same bytes.
