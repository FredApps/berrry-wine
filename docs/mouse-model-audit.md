# Mouse model audit (2026-10-06, MOUSE-MODE-AUDIT)

## tl;dr

```
+-----------------------+--------------------------------+--------------------------+------------------------------+
| guest mouse model     | how the guest reads it         | page must give it        | today                        |
+-----------------------+--------------------------------+--------------------------+------------------------------+
| CAPTURED / RELATIVE   | DirectInput mouse counts, or   | Pointer Lock deltas      | only with relativeMouse:true |
|  (Quake, Blood II,    | SetCursorPos-to-centre every   | (phone: virtual          | (12 apps). Everything else   |
|   Unreal, Anachronox) | frame + read distance from it  |  trackpad)               | gets ABSOLUTE -> cursor pins |
|                       |                                |                          | in a corner / turning stops  |
|                       |                                |                          | at the page edge             |
+-----------------------+--------------------------------+--------------------------+------------------------------+
| ABSOLUTE, own cursor  | GetCursorPos / WM_MOUSEMOVE,   | absolute position, host  | absolute; host cursor hidden |
|  (Diablo, Moorhuhn,   | cursor drawn by the game       | pointer hidden           | at runtime when the guest    |
|   StarCraft)          | (ShowCursor(FALSE)/SetCursor 0)|                          | hides its own (works today)  |
+-----------------------+--------------------------------+--------------------------+------------------------------+
| ABSOLUTE, system      | window messages, Windows draws | absolute position        | absolute (works today)       |
|  cursor (apps, cards) | the cursor                     |                          |                              |
+-----------------------+--------------------------------+--------------------------+------------------------------+
```

- **There is no runtime detection today.** Capture is a hand-set per-app flag
  (`relativeMouse: true` in `lib/apps.js`; `mobileTouch` overrides the phone
  mode). A game that needs capture and lacks the flag gets absolute input.
- **Static evidence finds the candidates but cannot decide them.**
  `tools/mouse-model-census.js` reads every module of all 270 registry apps:
  54 carry `GUID_SysMouse`, 18 import `SetCursorPos`+`ClipCursor`, 28 only
  `SetCursorPos`, 65 are configured against the static suggestion. But a
  `GUID_SysMouse` is in the data of anything linked with `dxguid.lib` (aoe2,
  rct, heroes3 carry it), and Blood II opens its mouse through `EnumDevices`
  without that GUID at all.
- **The decision belongs at runtime, from two signals the emulator already
  sees** (section "Autodetect"): a DirectInput mouse acquired
  `DISCL_EXCLUSIVE`, or a `SetCursorPos` recentring loop. Either one means
  "capture"; neither means absolute.
- **Blood II now captures by default** (`relativeMouse: true`,
  `mobileTouch: 'trackpad'`), with its DirectInput mouse-look verified.

## What the page does with each flag

| flag (lib/apps.js) | desktop | phone |
|---|---|---|
| none (default) | absolute: the guest Win32 cursor follows the pointer | absolute taps; `auto` touch mode follows `relativeMouse` |
| `relativeMouse: true` | first click requests Pointer Lock; `movementX/Y` move the guest cursor by deltas (`renderer.handleRelativeMouseMove`); moves are held back until the lock is granted | virtual trackpad (drag = relative motion, tap = click at the guest cursor) |
| `mobileTouch: 'trackpad' / 'direct'` | — | forces the phone mode either way |
| `hideHostCursor: true` | hide the browser pointer during exclusive presentation | — |

Runtime already handled: the host pointer is hidden whenever the guest hides
its own cursor (`ShowCursor` count < 0 or `SetCursor(NULL)`;
`renderer.wantsHiddenMouse`). Cursor visibility does not decide the protocol
(Diablo hides its cursor and reads absolute positions), which is why the
capture choice was made explicit.

## Why absolute input breaks captured games

- **Recentring games** (Quake II engine: Quake II, Anachronox, Half-Life,
  Unreal) call `SetCursorPos(centre)` every frame and read
  `GetCursorPos - centre` as the motion. An absolute page pointer that rests
  off-centre reads as the same displacement every frame: the cursor runs into a
  corner and stays there (Anachronox's menu, 2026-10-06), or the view spins.
- **DirectInput mouse games** (Blood II, Descent 3, Drakan, AvP) read relative
  counts. Our DirectInput mouse turns page pointer movement into counts, which
  works until the pointer reaches the edge of the page: then turning stops.
  Pointer Lock has no edge.

## Autodetect (proposal)

Both deciding signals pass through code we own:

1. **Exclusive DirectInput mouse.** `IDirectInputDevice::SetCooperativeLevel`
   (src/09a8-handlers-directx.wat) stores each device's flags. A mouse device
   (`GUID_SysMouse`, or an enumerated `DI8DEVTYPE_MOUSE`/`DIDEVTYPE_MOUSE`)
   that is `Acquire`d with `DISCL_EXCLUSIVE` hides the Windows cursor and
   delivers counts only: capture. A NONEXCLUSIVE mouse is used for buttons or
   polling beside the system cursor: keep absolute.
2. **Recentring loop.** `SetCursorPos` reaches the host through
   `$host_set_mouse_position`. Three or more calls within ~1 s that land within
   a few pixels of the same point inside the game window (its centre in every
   case seen) is the recentring idiom: capture. A one-off warp (Diablo,
   Solitaire's card drag, screensavers) never repeats.

The WAT side raises a per-process `wants_relative_mouse` latch from either
signal and clears it when the device is Unacquired or the loop stops for a few
seconds (menus in Unreal and Blood II use the absolute cursor). The page reads
it where it reads `app.relativeMouse` today (`lib/browser-input.js`
`wantsRelativeMouse`): `relativeMouse: true/false` in the registry stays as an
explicit override; absent means "follow the latch". Pointer Lock still needs a
click, so the latch only arms capture for the next click — the same flow a
flagged app has today.

## The table

`node tools/mouse-model-census.js` (add `--all` for the 154 plain-absolute
apps, `--json` for the evidence). `*` = the configured default disagrees with
the static suggestion. "relative?" and "runtime" rows are the ones the
autodetect signals settle; the static column alone is not a verdict.

```
game                       | mouse model     | static evidence            | page today                     | suggest   
---------------------------+-----------------+----------------------------+--------------------------------+-----------
aoe2 *                     | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
arena_gog *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
atomic_bomberman_june_demo | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
avp_alien_demo *           | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
avp_marine_demo *          | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
black_white_2_demo *       | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
blood2_demo *              | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
braveheart_demo *          | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
carmageddon2_demo *        | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
cmr2_demo *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
colin_mcrae_rally_demo *   | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
crimsonland *              | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
daggerfall_gog *           | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
daikatana_demo *           | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dark_colony_demo *         | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dark_reign_demo *          | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
darkstone_demo *           | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
daytona_usa_deluxe_demo *  | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
descent3_demo *            | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
die_by_the_sword_demo *    | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
drakan_demo *              | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
driver_demo *              | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dungeons_of_dredmor *      | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dungeons_of_dredmor_releas | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dx_donuts *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
dx_flip2d *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
fallout_demo *             | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
freespace_demo *           | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
gta2_demo *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
heroes3_demo *             | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
hype_glide_demo *          | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
jardinains *               | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
liquid_war *               | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
marbles *                  | DI-mouse        | GUID_SysMouse              | absolute touch=trackpad        | relative  
mcm *                      | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
moorhuhn_2 *               | DI-mouse        | GUID_SysMouse              | absolute touch=trackpad hideCu | relative  
morrowind *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
mw3 *                      | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
nfs3_demo *                | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
nfs3_glide_demo *          | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
pawn *                     | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
pirates_2004 *             | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
populous_tb_demo *         | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
rct *                      | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
scummvm_fotaq *            | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
tworld *                   | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
ultima4_gog *              | DI-mouse        | GUID_SysMouse              | absolute                       | relative  
aoe1 *                     | DI/recentre?    | DirectInput+SetCursorPos   | absolute                       | relative? 
elasto_mania *             | DI/recentre?    | DirectInput+SetCursorPos   | absolute                       | relative? 
myth_tfl *                 | DI/recentre?    | DirectInput+SetCursorPos   | absolute                       | relative? 
pocket_tanks *             | raw-input       | RegisterRawInputDevices    | absolute                       | relative  
atlantis_demo *            | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
bricks *                   | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
captain_claw_demo *        | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
commandos_demo *           | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
dark_earth_demo *          | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
dungeon_keeper_demo *      | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
generally *                | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
generally_track_editor *   | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
mspaint *                  | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
simcity2000_net *          | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
simcity2000_net_server *   | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
snood *                    | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
starcraft_shareware *      | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
warcraft3_demo *           | recentre?       | SetCursorPos+ClipCursor    | absolute                       | relative? 
blobby_volley              | absolute        | GetCursorPos               | absolute touch=direct          | absolute  
gallinelle                 | absolute        | GetCursorPos               | absolute touch=trackpad hideCu | absolute  
moorhuhn                   | absolute        | GetCursorPos               | absolute touch=trackpad hideCu | absolute  
moorhuhn_3                 | absolute        | window messages            | absolute touch=trackpad hideCu | absolute  
moorhuhn_winter            | absolute        | window messages            | absolute touch=trackpad hideCu | absolute  
cave_story                 | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
dx_boids                   | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
dx_viewer                  | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
icy_tower                  | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
scr_win98                  | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
tomb_raider_2_demo         | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
tomb_raider_3_demo         | DI (kbd?)       | DirectInput, no mouse GUID | absolute                       | runtime   
anachronox_demo            | DI-mouse        | GUID_SysMouse              | relative                       | relative  
arcanum_demo               | DI-mouse        | GUID_SysMouse              | relative touch=trackpad hideCu | relative  
deus_ex_demo               | DI-mouse        | GUID_SysMouse              | relative touch=trackpad        | relative  
ut2003_demo                | DI-mouse        | GUID_SysMouse              | relative                       | relative  
ut2003_demo_server         | DI-mouse        | GUID_SysMouse              | relative                       | relative  
ut2004_demo                | DI-mouse        | GUID_SysMouse              | relative                       | relative  
ut348_demo                 | DI-mouse        | GUID_SysMouse              | relative                       | relative  
halflife_uplink            | recentre?       | SetCursorPos+ClipCursor    | relative touch=trackpad        | relative? 
hitman_glide_demo          | recentre?       | SetCursorPos+ClipCursor    | relative                       | relative? 
quake2_demo                | recentre?       | SetCursorPos+ClipCursor    | relative touch=trackpad        | relative? 
unreal_special_demo        | recentre?       | SetCursorPos+ClipCursor    | relative                       | relative? 
alien_shooter              | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
alpha_centauri_demo        | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
curse_monkey_island_demo   | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
diablo_demo                | warp/recentre?  | SetCursorPos               | absolute touch=direct hideCurs | runtime   
diablo_shareware           | warp/recentre?  | SetCursorPos               | absolute touch=direct hideCurs | runtime   
diablo2_demo               | warp/recentre?  | SetCursorPos               | absolute touch=direct          | runtime   
diablo2_glide_demo         | warp/recentre?  | SetCursorPos               | absolute touch=direct          | runtime   
dxball                     | warp/recentre?  | SetCursorPos               | absolute touch=direct          | runtime   
fontview                   | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
fourstones                 | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
nfs2_demo                  | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
pinball                    | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
pinball_plus95             | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
qbob                       | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
regedit                    | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
ricochet_xtreme            | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_architec               | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_fallingl               | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_geometry               | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_jazz                   | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_oasaver                | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_rockroll               | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
scr_scifi                  | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
sol                        | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
total_annihilation_demo    | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
winamp                     | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
winamp_mod                 | warp/recentre?  | SetCursorPos               | absolute                       | runtime   
worms2_demo                | warp/recentre?  | SetCursorPos               | absolute                       | runtime   

270 apps scanned (116 shown; --all for the plain-absolute rest).
by model: absolute 159, warp/recentre? 28, recentre? 18, DI-mouse 54, DI (kbd?) 7, raw-input 1, DI/recentre? 3
* = configured default disagrees with the static suggestion (65 apps)
```

## Follow-ups

| row | what |
|---|---|
| MOUSE-AUTODETECT | implement the latch above (WAT signals + `wantsRelativeMouse`), with a unit test per signal |
| MOUSE-DYNAMIC-CENSUS | boat sweep: run each `*` app to its first interactive screen with `--trace-api=SetCursorPos,IDirectInputDevice_SetCooperativeLevel,IDirectInputDevice_Acquire` and record which signal fires; replaces the static column |
| MOUSE-FLAG-FPS | mouse-look 3D games with DirectInput mouse that should capture now, each verified like Blood II: descent3_demo, drakan_demo, daikatana_demo, avp_alien_demo, avp_marine_demo, die_by_the_sword_demo, freespace_demo, mw3, hype_glide_demo |
