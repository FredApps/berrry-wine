# SimCity 2000 Win95 Demo (`simdemo.exe`)

Registry id `simcity2000_demo`, local-only (`test/binaries/candidates/simcity-2000-demo/installed/`).
Maxis/MFC, MDI frame + one MDI child. Loads at the usual `0x400000`, so a
runtime EIP is the original VA unchanged.

Reaching the city headlessly:

```
node test/run.js --no-build --app=simcity2000_demo --max-batches=60000 \
  --max-seconds=60 --no-close --quiet-api \
  --input=25:dlg-cmd:1,2000:mousedown:215:93,2050:mouseup:215:93 --png=/tmp/sc2k.png
```

`25:dlg-cmd:1` answers the startup "Video Warning" box; the click at 215,93 is
the "Load Demo City" button on the launcher window. A few thousand batches
later a demo notice ("I will now demonstrate some of the Disasters") appears
over a live, simulating map.

## Functions identified

| VA | What it is |
|---|---|
| `0x00478c77` | startup display check — `GetDeviceCaps` RASTERCAPS/BITSPIXEL/PLANES, then the Video Warning |
| `0x004a87af` | registry-backed settings read (`RegQueryValueEx` through `[0x4d7760]`) |
| `0x0049b7ab` | matching settings write |
| `0x004a4977` | MFC MRU scan: walk an HMENU for a command id in `0xE130..0xE13F` |

## "You're not running in 256 colors" is correct, and one-shot

`0x00478c77` reads `GetDeviceCaps(hdc, 12)` BITSPIXEL into EDI, `(hdc, 14)`
PLANES into EBX and `(hdc, 38)` RASTERCAPS masked with `RC_PALETTE` (0x100).
We report 32 / 1 / 15033 — a true-colour display, which is what the emulator
actually presents — so the `cmp edi, 8` at `0x478cde` fails and the warning
path runs. It is not a failure path: the code at `0x478cff` reads
`HKCU\Software\Maxis\SimCity 2000 Win95 Demo\Windows\Last Color Depth`, warns
only when the stored depth differs from the current one, and writes the
current depth back. So the box appears once per fresh registry and never
again, exactly as it would on real hardware after a resolution change.
Nothing about the game is degraded by it; the animations it mentions are
palette animations a 32bpp display has no equivalent for.

## "Load Demo City" used to hang: detached HMENU (fixed)

`0x004a4977` is MFC's scan for the MRU id block:

```
esi = GetMenuItemCount(hMenu) - 1
if (!count) return
loop: edi = GetSubMenu(hMenu, esi)
      if (edi) for (ebp = 0; ebp < GetMenuItemCount(edi); ebp++)
                   if (0xE130 <= GetMenuItemID(edi, ebp) <= 0xE13F) return found
      eax = esi; esi--; if (eax) goto loop
```

`hMenu` is `0x00BE0003` — MFC's `CMultiDocTemplate::m_hMenuShared`, loaded by
`LoadMenuA(0x400000, 3)` and *never attached to a window*. Our menu model kept
every blob in `MENU_DATA_TABLE[slot]` and resolved a handle by finding the
window that owns it, so `GetMenuItemCount` answered -1 for this one. `-1 - 1`
is -2, `test eax, eax` is nonzero, and the loop counts down through four
billion iterations.

Measured before the fix (`--handler-hist --handler-hist-thread=0 --handler-hist-start=2060`):
the three blocks `0x004a4993` / `0x004a499e` / `0x004a49ce` take **21,333,15x
entries each, 31.17% apiece — 93% of all work in the run**, with 23M Win32
calls against ~5 per batch before the click. `[sync] ABANDONED wndproc
hwnd=0x1003c msg=0x222 ... after 64 rounds` in the same log is the same event
seen from the other side: `$wnd_send_message` gave the MDI child's
WM_MDIACTIVATE 64 × 1,000,000 steps and gave up.

Fixed in `src/09c5-menu.wat` by materializing an unattached `LoadMenu` handle
as an ordinary dynamic (MNUD) menu built from its RT_MENU template, cached by
resource id (`$menu_detached_handle`). Afterwards: 711k API calls and 60,000
batches in 14.8s where the same route was 23M calls and 134k batches in 71s,
and the map draws. Covered by `test/test-detached-menu-handle.js`.

## City simulation: where the CPU goes (measured 2026-09-21)

Window: batches 8000-20000 of the recipe above (game date Mar -> Jul 1982),
`--handler-hist --handler-hist-thread=0 --handler-hist-start=8000
--hot-block-dump=` plus `--quiet-blocks` (without it the per-batch register
line is 45% of the process). Counts, not timings:

* 47.2M ops, 12.09M block entries: **3.9 ops per block**, ~11-12M ops per
  game month. Terminators: Jcc 75%, fall 7.2%, jmp 7.1%, ret 4.4%, call 4.1%.
* The simulation is 128x128 tile passes written with 16-bit frame locals and
  the same `0 <= x,y < 128` test repeated 2-3 times per tile, each compare its
  own two-instruction block (`cmp word [ebp-x],imm / jl`). No loop matcher
  sees any of it: loop-class-share says `none` 60%, `declined:call` 14%,
  DIAMOND ~16%, SELF 0.4%.

| region (share of block entries) | what it is |
|---|---|
| `0x45ad35` fn, loop `0x45b021` (18.2%) | per-tile score: two 4-compare bounds ladders, tile-bit tests via row tables `0x4b50f0`/`0x4b3710`, one if/else join `jmp` |
| `0x448e20` (12.6%) | neighbour walk: `call 0x40171c` per neighbour, then a tile-type range ladder (`cmp ax,lo / jb / cmp ax,hi / jb`) |
| `0x454f3e` (10.8%) | 128x128 pass clearing flag bits 0x10/0x08, four bounds checks per tile per bit |
| `0x458117` (8.3%) | 128x128 bit-mask pass then tile-type tests |

`0x40171c` is `jmp 0x423a11`: the exe is incrementally linked, 1624 `e9`
thunks at `0x401000..0x402fb8`, and thunk blocks are 1.95% of all block
entries in the window.

Two decoder costs this code shape exposes (counts from the same window):

* `$th_compute_ea_sib` (H149) is 2.76M ops, **5.8% of all ops** — a separate
  dispatch computing an address because the 16/8-bit memory handlers
  (`inc/dec word [ebp-x]`, movzx byte, `mov m16`) have no fused base+disp form.
* The fused `test r,r + Jcc` (H404, 844k) always leaves through
  `$branch_end`, so its not-taken edge never gets the free adjacent
  fall-through a plain Jcc gets.

Wasm self-time split (30000-batch run, `tools/dispatch-attribution.js`):
`$branch_end_at` 9.4% (the desk, including its successor dispatch), the
specialised Jcc handlers 10.9%, `$get_of` 2.1%, GDI/controls ~17% (font face
string compares on every text out, `$gdi_bitmap_font_face_equal` 2.0%, and
`$ctrl_get_wh_packed` 1.8%).
