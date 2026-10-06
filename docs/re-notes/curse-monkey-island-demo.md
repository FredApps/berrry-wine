# The Curse of Monkey Island demo

The local original demo comes from the Windows 98 A-D distribution linked
in `sources.md`. The package and playable files remain local-only.

- `COMI.EXE` SHA-256:
  `b55524231edacc7d184c22c762d25193d616adc55d0141785fb21b8890d352b9`
- `CURSE.EXE` SHA-256:
  `b635bef2e58c91faa9592ea19200ffa031a44e8d55a4cd62245e392aef3683f3`

The bundled README identifies demo 1.0 and requires Windows 95, a Pentium,
16 MB RAM, CD-ROM, and a mouse. `CURSE.EXE` is the original launcher: a real
emulated launch displayed Play, Install DirectX, Readme, Troubleshooting,
and Exit. It reached the child-launch yield without a game-copy wizard.
The top artwork panel was initially blank; the etched-static fix below
restores it.
The registered app runs `COMI.EXE` with the original 11 companion files.

## Functional acceptance

`test/test-comi-gameplay.js` uses the frozen headless CLI, skips the opening
dialogue with Escape, and clicks the hold floor at `(250,390)`. Before and
after screenshots show Guybrush standing at the right wall and then walking
toward the center. The test measures his distinctive cream-shirt palette
pixels, requiring a leftward displacement greater than 60 pixels, rather
than counting cannon animation or mouse-cursor changes as player movement.
The verified run measured x=438 to x=335 and exited cleanly.

Screenshots are written to `COMI_SCREENSHOT_DIR` or the temporary directory
`wine-assembly-comi-gameplay`. The test pins the original executable hash;
its palette assertion is specific to that demo and scene.

The regression also right-clicks to open the inventory chest, closes it,
then holds the left button over the small pirate to open the verb coin.
Both captures were visually inspected. Region-specific brown chest and
gold coin pixel thresholds assert those controls appeared; selecting a
verb and completing the demo's puzzle remain unverified.

## Launcher artwork investigation

The blank panel is not evidence of an absent bitmap resource. `CURSE.EXE`
contains bitmap resource 184, and its launch trace calls `LoadImageA` for
that resource with dimensions 240x197 and `LR_CREATEDIBSECTION`, followed
by a successful `BitBlt` into the dialog at `(0,3)`. A static child occupies
the same rectangle. Trace control paints and DC targeting before deciding
whether loading, rasterization, or a later repaint loses the artwork.

The resource header is a 40-byte BITMAPINFOHEADER: 320x240, 8bpp,
BI_RGB, 76800 pixel bytes (raw PE offset `0x2cefc`). The overlapping
dialog-102 static is control 1003, style `0x50000012`, not SS_BITMAP.
`--trace-ctrl` confirms it paints at screen `(199,77)` with extent 240x197.
The LoadImage result selected into the source DC is nonzero (`0x410005`).
These observations narrow the next probe to actual bitmap pixels and
destination/repaint behavior; a successful BitBlt return alone does not
prove visible rendering. The bounded 80-step probe exits cleanly.

### Etched frame fix

The cause was static-control painting: a four-bit type mask changed
SS_ETCHEDFRAME (`0x12`) into SS_RIGHT (`0x02`), then its text-label fill
erased the parent's artwork. Preserve five type bits and handle etched
horizontal, vertical, and full frames with EDGE_ETCHED and the appropriate
border flags, without BF_MIDDLE. This follows the
[static-control style contract](https://learn.microsoft.com/en-us/windows/win32/controls/static-control-styles).

`test/test-static-bitmap-control.js` seeds colored interior pixels and
checks all three etched styles across repeated paints, including which
edges change. It failed gray before the fix and passes afterward, alongside
the existing resource/dynamic bitmap coverage. The original launcher now
shows the moon, sea, and Guybrush in his boat; its capture was inspected.
The art region changed from zero to 38238 chromatic pixels. Canonical and
compat builds pass, as does the full COMI movement/inventory/verb-coin test
against the new build. This verifies artwork presence, not exact LoadImage
scaling fidelity or every launcher button.

## Hot loop: the destination-blended LUT at `exe+0x40340e`

The #1 hot block across three profiling windows, at **11.62 / 11.72 / 11.68%**
of block entries (spread 0.11pp — flat, unlike most hot-loop measurements), and
**35.12 / 35.24 / 35.14%** for the region within ±0x60.

```asm
0040340e  mov dl,[eax]          ; src index
00403410  inc eax
00403411  cmp dl,0xff
00403414  jz short 0x40343a     ; transparent
00403416  cmp dl,0x8
00403419  jnb short 0x403438    ; opaque passthrough
0040341e  mov bl,dl
00403422  shl ebx,0x8
00403425  mov dl,[ecx-0x1]      ; dst index
00403429  mov dl,[ebx+edx+0x4d30d0]   ; 64KB blend table
00403430  mov [ecx-0x1],dl
00403433  jnz short 0x40340e
```

A destination-blended 2D lookup, `dst = tbl[(src<<8)|dst]`, table at
`0x4d30d0`. Both branches target addresses *past* the back edge, so they are
loop exits with no internal edge — which makes this a `SELFEXIT`, not a
self-loop, and therefore invisible to `$loop_match_block`: the decoder splits
the block at the first `jz`. See §22 of
[loop-idiom-superops-design.md](../loop-idiom-superops-design.md).

`tools/find-ck-lut-nests.js` classifies it `LUT8_NOKEY`. `tools/match-loops.js`
on COMI: 956 loops, 58 matched (6.1%), 203 `multi-branch` declines.

## 2026-10-03 browser audio investigation

Normal current-source private emulator launch uses the Worker backend and waveOut streaming, not a DirectSound ring. AudioContext is running at 22050 Hz; the active stream is stereo 16-bit. In a 10.00138-second wall-clock window, 569344 submitted bytes represent 6.45515 seconds of PCM. The stream clock rebases forward 3.56426 seconds as its queue drains. The 12-second PulseAudio monitor capture contains 34.29% exact-zero stereo frames, with no clipping. This reproduces queue starvation; it does not establish why the game supplies buffers late.

Baseline evidence: `scratch/comi-audio-investigation-20261003/browser/attempt1/`, including audio.wav, three snapshots, 18 independently rehashed artifacts and root-review.json. Two vendor scripts were only hash-checked after launch; core/audio source pins matched. Browser and recorder exited cleanly. No ordinary-playback FPS claim or public deployment was made.

The public audio modules match local sources. Public host enables liveAudioRing after successful Worker start, so its missing cooperative default is not the explanation for this observed waveOut path. Next diagnostic separates audio-end→WAVEHDR DONE notification delay from DONE→guest refill delay; callback type and actual producing thread must be observed before a scheduler fix.

The follow-up uses the existing host profiling hook and passive header sampling (no guest writes). In2.796seconds it records43writes of4096bytes, callback type0/target0, producer thread0 and no auxiliary threads. Host write processing is fast (median0.155ms, maximum0.32ms). Scheduled playback gaps total859ms. First observed DONE follows audio end by0–23.22ms; first observed DONE to the next write has median41.3ms and maximum92.31ms. Those are sampled cross-event observations, not exact same-header reuse delays. Observer cost26.82ms total; maximum poll gap11.89ms, with wider retained transition brackets. This supports late main-thread refill; it does not yet distinguish guest pacing, execution budget and mixing cost.

Exact guest code initializes eight4096-byte headers and uses CALLBACK_NULL polling. waveOutWrite init call422fdc, refill4231c9; WHDR_DONE check42311e. The main mixing routine425030 calls refill before/after mixing at425079/4251bb. Preserve this pair when tracing: the alternating gate is not by itself evidence of half-rate audio. Next useful observation is owning-main-Worker time spent around this mixing routine versus sleep/yield, without changing audio buffering to mask the gap.

Follow-up artifacts: `scratch/comi-audio-investigation-20261003/browser/followup/attempt2/`. Attempt1 stopped at a private helper timer-binding error; it is not game failure evidence. No emulator repair is accepted from these observations.

Independent timing review (`scratch/comi-audio-investigation-20261003/review.json`) associates 19 positive scheduling gaps totaling 859.138 ms. For every gap, the previous header was already observed DONE 31.48–46.975 ms before the next write. This rules out late completion notification as the sole cause, while preserving uncertainty about the exact guest-side pacing mechanism and unobserved header reuse.

### 2026-10-05: service registration and next timing diagnostic (source only)

Bounded EXE inspection identifies an indirect service registration: `424c6b` stores callback `424ce0` into the caller descriptor at `+0x18`; `424c64` reads descriptor `+0x1c`, saved into `48e7fc` at `424c7c`. This explains the lack of direct call xrefs, but does not establish actual calling cadence or a timer association. The next diagnostic should collect the owning entry return address plus ordinary main-Worker slice/request gaps before enabling block tracing. `set_trace_eip_range` disables optimized execution paths, so traced wall time cannot establish normal mixer cost. See `ops/handoffs/comi-mixer-timing-plan-20261005.md` and exact disassembly/current offline source pins in `scratch/comi-audio-investigation-20261003/mixer-timing/`. No new runtime, audio measurement, or fix in this source audit.
