# Over 1000 Games for Windows (Nodtronics, 2001) — the titles that came up blank

A 2001 shareware CD, mostly 16-bit NE. The corpus is **local-only** under the
Nodtronics EULA — nothing here may be published or deployed.

This note covers the seven titles a registry sweep scored as "launches but does
not draw", because five of them were not one problem and the sweep's verdict was
wrong about three of them for three different reasons.

## Verdicts

| id | exe | 2026-09-20 |
|---|---|---|
| `board-scrabout` | SCRABOUT.EXE | draws — two fixes, below |
| `board-3dshere` | SPHEJONG.EXE | draws — needed USER.82 `InvertRect` |
| `strategy-jiggler` | JIGGLER.EXE | plays — three menu fixes plus named FindResource |
| `board-wingong` | MOREJONG.EXE | draws — longer budget |
| `strategy-klotski` | KLOTSKI.EXE | plays — the blank capture was a fluke |
| `cards-sokoban` | SOKOBAN.EXE | runs, window and menus draw — four fixes; the CD lacks its level file |
| `arcade-clxwrk` | CLOCKWRX.EXE | plays — installed layout, a USE32 blitter via DPMI, mm timers, caret, top-down DDBs |

The five commercial titles, tracked separately: SimCity 2000 and MicroMan run,
Exile II reaches its title screen after a three-stage install (below), Pitfall
plays its attract demo now that DISPDIB answers, and Bad Toys 3D installs
through both of its stages and runs — so all five are past their blockers.

## The sweep's verdict is not evidence

Three of the seven were photographed too early or under load, not broken:

- **A MoraffWare loader needs tens of thousands of batches.** `strategy-jiggler`
  and `board-wingong` are blank at 6,000 batches and draw at a 40-second budget.
  `tools/iso-title-sweep.js` defaults to 8,000 batches / 25s, which is under the
  bar for this publisher's whole catalogue.
- **A `--png` capture can come back fully transparent on a loaded box.**
  `strategy-klotski` produced a 100%-transparent PNG in one sweep run and a
  correct 203-colour picture from the same command line afterwards. *Fully
  transparent* (nothing composited) and *flat desktop teal* (composited, no
  window) are different failures — `node tools/png-inspect.js stats` separates
  them and the byte count does not.
- **Two of the "blanks" were early crashes**, which the sweep cannot tell apart
  from a blank because both end with a teal PNG.

## Moraff's Jiggler

Three things stand between a cold start and a game, and only the first is the
app being coy.

**1. The "Critical Note:" box.** An `MB_OKCANCEL` message box greets every
launch and says the menu only appears when you point at the upper-left corner
of the screen. `IDCANCEL` is the "never show this again" answer, so the
headless route is `--input=40000:dlg-cmd:2`.

**2. Its menu lives on a borderless WS_POPUP dialog.** `LoadMenu` resolves the
named `MAINMENU` resource, `menu_load` installs six bar items, and the app then
`SetParent`s the 1305x42 menu strip onto the game window. Fixed 2026-09-20
(`7aa1b93c`): `SetParent` was marking any reparented window `isChild` (which
costs it the bar outright), `drawWindow` painted a bar only for a *bordered*
window, and `handleMouseDown` dropped the click because a menu bar is outside
the client rect of a dialog with a parent. Regressions:
`test/test-set-parent-keeps-popup-toplevel.js` and
`test/test-menu-bar-borderless-dialog-click.js`.

The two `$win16_trace` markers added with that fix are the ones to reach for on
any "the menu is empty" report: `0xCA16A9E4` is every NE resource lookup with
its result, `0xCA16A9E3` is `menu_load`'s outcome stage (4 = resource not
found, 6 = parsed zero bar items, 7 = installed, with the bar count). They say
in one line whether the resource or the parse is the problem — here it was
neither.

Reaching a game, with the menu geometry as of that commit:

```
node test/run.js --exe=<dir>/JIGGLER.EXE --vfs-include='*.BKG,*.TIF,*.ID' \
  --quiet-api --no-close --max-batches=90000 \
  --input=40000:dlg-cmd:2,50000:mousemove:2:2,60000:click:110:8,\
62000:click:130:30,65000:click:300:30
```

`&Start New Game` (id 104) is a *bar* item, not a popup — clicking it at
`40,8` posts `WM_COMMAND 104` directly. The sized games are under
Play -> New Memory Jigsaw Game -> 4x4..20x20 (ids 5004..5020). `--input=…
menu-dump:bar` prints the whole open tree, and `node tools/ne-dump.js … --menus`
prints it statically.

**3. `FindResource` refused every resource named by string.** That is what
made the game area black. JIGGLER keeps its whole picture and sound set in
custom NE resource types — `node tools/ne-dump.js JIGGLER.EXE --all` shows 52
`"WAVE"` and 10 `"TEXT"` entries, all with *string* names — and
`$win16_FindResource` bailed out whenever the name argument was a far pointer
rather than a `MAKEINTRESOURCE` integer, so all of them came back NULL. The
consequences read nothing like the cause:

```
KERNEL.60 FINDRESOURCE(…) -> AX=0x0000      x20, every one of them
KERNEL.62 LOCKRESOURCE(0) -> DX:AX = 0:0
<module 13>.2 (0x37:0x8dd0, 0, 0, 0)        L_InitBitmap with a 0x0x0 image
GDI.51 CREATECOMPATIBLEBITMAP(hdc, 0, 0)
GDI.45 SELECTOBJECT(0x111, 0)               a NULL bitmap in the memory DC
GDI.35 STRETCHBLT(… wSrc=0, hSrc=0 …)       x10000, over the board
```

A working load looks the same with numbers in it: `<module 13>.2(pBitmap,
620, 440, 24)` and then 13 `STRETCHDIBITS` of 35 scanlines each.

Fixed 2026-09-20. The by-name machinery already existed in the NE walker
(`$win16_find_resource_ex` takes a `name_wa`) and only `FindResource` did not
use it. The wrinkle is that `FindResource` returns a *handle* and every later
call works from that handle alone, by which time the caller's string may be
gone — so the scan now records the matched NAMEINFO id word in
`$win16_res_found_id`, the descriptor carries it (a fourth word; the stride
went 12 -> 16), and `$win16_find_resource_rid` re-finds that exact entry for
LoadResource/LockResource/SizeofResource/AccessResource. A named entry's id
word has bit 15 clear and an integer id always has it set, so the two can
never be confused. Regression: the SOL block in `test/test-win16-exec.js`.

The board now draws: 18,785 colours at the route below, wood-grain tile backs
and the working clock widget, against 196 colours and a black rectangle
before.

## Klotski

Its "blank" attract screen is a LineTo/Rectangle animation — 563,000 `LineTo`
calls in 40 seconds, which is also why it only turns over ~450 batches/s. The
menu bar opens on a click at `35,50`, and `--input=8000:post-cmd:300`
("Level &1") starts a game: 32.38% of the pixels inside `24,72 472x265` change.

## ScrabOut

Two independent problems, in this order.

**1. The dictionary is shipped compressed.** The CD carries `DICTNARY.DA_` and
`DICTNARY.ID_` (SZDD) and the installer expands them. Mounting the raw CD
directory gives the app `DICTNARY.DAT` but no `DICTNARY.IDX`, and it answers
with `FatalAppExit(0, NULL)` — no message, so the run just exits 1 and the
next instruction fetch goes through a NULL far pointer. `--trace-win16` names
it in one line (`KERNEL.74 OPENFILE … -> AX=0xFFFF`, then `KERNEL.137
FATALAPPEXIT`), and `--trace-fs` names the file:

```
node tools/szdd.js <dir>/DICTNARY.ID_ <dir>/DICTNARY.IDX
```

This is an install-time asset, not an emulator gap.

**2. `GetPrivateProfileInt` lost a `0x8000` default.** ScrabOut keeps its window
rectangle in an INI and asks for Left/Top/Width/Height with `CW_USEDEFAULT`
(`0x8000` in Win16) as the default. The Win16 shim read `nDefault` through
`$win16_coord` — the helper that exists to turn the *window coordinate* `0x8000`
into the 32-bit sentinel `0x80000000` — and the WORD these calls return masked
that back to 0. So the app created its main window `0,0 0x0`, visible and
painting into nothing: a teal desktop at every budget.

Fixed 2026-09-20 (`18a63715`); `nDefault` is a UINT and is read as a plain word.
Window is now `20,20 480x321`. Regression: `test/test-win16-profile-int-default.js`.

The tell was in the trace and nowhere else: the four `GETPRIVATEPROFILEINT`
calls carrying `0x00008000` each returned `AX=0x00000000`, while the very next
one with a default of `1` returned `1`.

## SphereJongg

Ran ~42,000 batches and stopped with a bare `unreachable`. The last log line is
`[win16] USER.82 INVERTRECT` — the format `test/run.js` prints for the *Win16
unimplemented-API* marker, which reads exactly like an ordinary trace line, so
the stop looked like an emulator crash. The dispatch had USER.81 `FillRect` and
USER.83 `FrameRect` and nothing between them.

Implemented 2026-09-20 (`8f061f96`). Runs a full 45s with no crash; capture went
from no PNG at all to 659 KB / 100,397 colours. Regression:
`test/test-win16-invert-rect.js`.

## Sokoban (runs; the CD shipped the wrong SOKOBAN.TXT)

VB3 (`VBRUN300.DLL`). Crashes at batch 72 inside `$decode_block` with marker
`0xCA002E20` — "execution entered zeros" — at guest `0x002fec83`, which is an
unmapped run of nulls. The last Win16 calls before it are ordinary
(`GetSystemMetrics`, `GetObject`, `LocalAlloc`), so nothing names itself. Same
marker class as the RollerCoaster Tycoon display-mode crash documented in
`lib/app-profiles.js`: the guest transfers control to an address it should never
have computed, so the interesting question is which earlier write produced the
bad pointer, not what the decoder did with it.

```
node test/run.js --exe=<dir>/SOKOBAN.EXE --vfs-include='*' \
  --win16-lib=<dir>/VBRUN300.DLL --max-batches=400 --no-close --trace-win16
```

**2026-09-20: it is a stack pivot through DI, not a decoder problem.** The
marker payload is `0xCA002E20`, faulting EIP `0x002fec83`, previous EIP
`0x002f5204` — same 64KB segment (selector `0x107`), so this is a *near*
transfer inside one VBRUN300 segment, not a bad far call. `0x2f5204` is three
instructions:

```
8b e7   mov sp, di
9d      popf
c3      ret
```

a longjmp-style pivot the segment's code `call`s outright (`0x2f4c1f:
e8 e2 05`). It is reached from several callers and only one of them is fatal:

| hit | prev_eip | DI |
|---|---|---|
| #2 | `0x2f4f0f` | `0x3ef8` — a real stack offset, returns fine |
| #3 | `0x2f4c1f` | `0x01e8` — pivots SP into unmapped memory, `ret` lands at `0xec83` |

So the corrupt value is **DI at the call**, and the decoder is only reporting
where a garbage return address led. The surrounding code is the Microsoft
floating-point emulator shipped inside VBRUN300 — `9b 36 dd 1c` (`fwait; ss:
fstp qword [si]`), a `2e ff a7 …` CS-relative jump table, `ff e1` — so the
next question is which earlier call fails to preserve DI across that segment's
x87 paths. Reproduce the table above with:

```
node test/run.js --exe=<dir>/SOKOBAN.EXE --vfs-include='*' \
  --win16-lib=<dir>/VBRUN300.DLL --max-batches=400 --no-close --quiet-api \
  --trace-at=0x002f5204
```

Ruled out: the target is not a missing relocation (the whole region from
`0x2fec60` on is zeros at batch 71, i.e. past the segment's real content), and
it is not a far-call selector problem.

**2026-09-20, correcting the above: DI is not the corrupt value.** Hit #1 and
hit #3 in that table have the *same* `DI = 0x01e8` and only one of them is
fatal, so DI cannot be what distinguishes them — and `0x2f5204` is not the
pivot either. The pivot `8b e7 9d c3` (`mov sp,di; popf; ret`) is at
**`0x2f5200`**, four bytes earlier; `0x2f5204` is a separate entry point that
shares the tail of the same routine:

```
2f5204  59              pop cx              ; return address
2f5205  36 89 1e 72 02  ss: mov [0x0272], bx
2f520a  5b              pop bx              ; the index, from the caller's push
2f520b  8b c3           mov ax, bx
2f520d  03 db           add bx, bx
2f520f  2e ff a7 5a 51  jmp word cs:[bx+0x515a]
```

So the fault is a **jump-table dispatch with an out-of-range index**, and the
whole chain is now visible:

| | working hit | fatal hit |
|---|---|---|
| caller | `0x2f4f0f` | `0x2f4c1f` |
| popped index | `0x0002` | `0x0078` |
| `bx` after doubling | `0x0004` | `0x00f0` |
| entry read | `cs:0x515e` | `cs:0x524a` = `0xec83` |

`0xec83` is not a bad pointer into a segment we failed to fill: **no VBRUN300
segment is that large.** The module's 101 segments top out at `alloc=0x9d5a`
(`node tools/ne-dump.js VBRUN300.DLL --segments`), so offset `0xec83` does not
exist anywhere in it, and the zeros at `0x2fec60`+ are simply the unused tail
of the 64KB selector stride. The word at `cs:0x524a` is `83 ec`, the first two
bytes of a `sub sp,0x0a` in the *handler bodies* that follow the table — the
index ran off the end of the table and read code.

Where `0x78` comes from is settled too, with a watchpoint on the stack slot the
dispatcher pops:

```
node test/run.js --exe=<dir>/SOKOBAN.EXE --vfs-include='*' \
  --win16-lib=<dir>/VBRUN300.DLL --max-batches=4000 --no-close --quiet-api \
  --watch-word=0x001170ca --watch-log --watch-value=0x0078
```

It is written by `push ax` at **`0x2f3ffe`** (`50`, immediately followed by
`6a 02`, `push 2`), on the threaded path that then runs `es: lodsw; jmp ax` at
`0x2f4001` — the FP library's own address-stream interpreter. So two words go
on the stack, a `2` and a computed value, and by the time the dispatcher runs
the `2` is gone, the return address `0x4c22` sits in its slot, and the
dispatcher pops the *other* one as its index.

**The bug is therefore a stack imbalance of exactly one word on the path from
`jmp ax` to the call at `0x2f4c1f`, not a corrupt register.** The next step is
to find which routine on that threaded path returns without popping the word it
was given — the candidates are the x87 sequences in this segment (`9b 36 d9 1c`
= `fwait; ss: fstp dword [si]` at `0x2f51f4`, and the `sub sp,0x0a; mov di,sp;
fwait; ss: fstp qword [di]` bodies at `0x2f5240`+), because those are the only
places where our emulation, rather than the guest's own code, decides what the
stack looks like on the way out. Note this is the coprocessor-*present* path of
the MS floating-point library, which is the right one for us to be on: the NE
loader deliberately leaves OSFIXUP (type 3) records alone
(`src/08c-ne-loader.wat:384`), so those really are x87 instructions and not
emulator call sites.

One named suspect to check first, because it is ours and it is stack-neutral
by construction: `$th_int` (`src/05c-seg16-ops.wat:650`) services `INT 21h` and
answers every other vector by setting CF and resuming, pushing nothing. The MS
floating-point library's vectors are `INT 34h`–`3Eh`, and a real one pushes
three words that an `IRET` on the far side takes back off. If any path in this
segment still reaches an `IRET` — or a handler written to be entered by an
INT — the word counts on the two sides do not match, and one word is exactly
the discrepancy measured above. Confirm or eliminate that before hunting a
missing `pop` in the guest's own code.

**2026-09-20, resolved: it was our `pop sp`, fixed in f04f2721.** The `$th_int`
suspect is eliminated on two counts. `$th_int`'s non-21h branch pushes nothing
and returns nothing, so it is balanced whatever the vector. And there is no
FP-emulator INT to speak of: SOKOBAN.EXE contains no `int 21h` or
`int 34h`-`3Eh` at all, and VBRUN300.DLL has 17 `int 21h` and exactly one
`cd 3d` -- in seg 33 at `0x000c`, not in the FP interpreter's seg 25, inside
`9b db 5e fc cd 3d 8b 46 fc`, straight after an `fwait; fistp`. `INT 3Dh` is the
MS emulator's FWAIT, so that one may well be a real instruction; if it runs,
`$th_int` treats it as a balanced no-op, which is what an FWAIT is here. An
emulator-vector build would show thousands, not one. (Count with
`find_bytes.js` and read the `Total:` line: `grep -c 0x` also counts the
`imageBase=0x0` header and reports 1 for a file with none.)

The jump table the dispatcher reads is **ten entries long** --
`0x5223 0x5223 0x5214 0x5223 0x522b 0x523f 0x5257 0x5236 0x5223 0x5223` at
`cs:0x515a`, with code resuming at `0x516e` -- so `0x78` was never an index
that happened to be too large; it was never an index at all. Tracing SP back
through the VM with `--trace-eip-range=0x002f3ff0-0x002f5210
--trace-eip-detail --trace-eip-stream` showed where the extra word went:

```
5214:  pop di; sub sp,8; push di; push ax
521a:  mov ax, sp          ; ax = 0x70bc, handed back through `jmp cx`
4f12:  add ax, 0x0c        ; 0x70c8 -- the VM stack to restore
4f18:  push ax             ; saved at [0x70ba]
 ...   (far call through the 0x4b76 thunk)
4f32:  pop ax; pop bx; pop cx
4f35:  pop sp              ; SP came back 0x70ca
4f36:  jmp ax
```

`$th_pop_r16` wrote the register and then added 2 to ESP unconditionally, so
for `pop sp` the increment landed on top of the value it had just loaded.
The 32-bit `$th_pop_r` already had the right order and a comment saying why.
`$th_push_r16` had the matching 8086-style bug (it stored SP after the
decrement), fixed in the same commit. With SP back at `0x70c8` the
dispatcher no longer runs off the table, and the run goes on past batch 72.

Now Sokoban runs past VB's startup: `REGISTERCLASS` for its form,
`CREATEWINDOW`, `SHOWWINDOW`, then the full `Thunder*` control set -- but after
30,000 batches the capture is still plain desktop teal, with ~7,600
`LSTRCMPI`s and ~925 identical rounds of `GetSystemMetrics(0,1,0x20..0x23)` +
`InvalidateRect`. That is the next question: a VB form that is shown and
invalidated but never lands on the screen.

**2026-09-20, the rest of the way: it runs, and the CD has no levels for it.**
Three more emulator bugs were between that state and a drawn window:

1. **GlobalSize reported the exact request (8d9186b5).** VB GlobalAllocs a
   file buffer (0x2c3 bytes, on its first `Open`), asks GlobalSize how big it
   is, and lays a sub-heap over the whole of it. Its first-fit walk at
   `0x390333` (`inc ax; xor bx,bx; add si,ax; jb fail; cmp si,dx; je end;
   mov ax,[si]; inc ax; test al,1; jnz loop`) steps in even strides and stops
   only on `si == dx`, so an odd end is stepped over and the walk never ends.
   Windows 3.1 hands global memory out in 32-byte units and reports the rounded
   size; `$win16_gsize` does the same now.
2. **USER.237 GetUpdateRgn was not in the Win16 dispatch (8d9186b5).** The
   form's first WM_PAINT trapped on it at batch ~4,446.
3. **GetParent returned the owner of an overlapped window (fc2781a0).** A VB
   form is style `0x02cf0000`: overlapped, owned by VB's hidden 0x0 main window,
   which VB creates at the centre of the screen (320,240). VB turns a form's
   GetWindowRect into Left/Top with `ScreenToClient(GetParent(form))`, so every
   Move shifted the form by -320,-240. It went (25,20) -> (-295,-220) ->
   (-615,-460), and the capture was teal because the window was off screen.
   Windows returns the owner only for `WS_POPUP` and NULL here. The tell was
   `--trace-ctrl`: `hwnd=0x10002 ... at -615,-460`.

With those, the form sits at (25,20), 499x81, with its caption and a working
Game / Board / Help menu. **Game > New** reads `SOKOBAN.TXT` to EOF twice, then
leaves the board empty. That is correct: **the level file is missing from the
CD.** The exe names it (`\SOKOBAN.TXT`, `SOKOBAN.TXT not found`, `Sokoban level
file not available`), but the `SOKOBAN.TXT` in `CARDS/SOKOBAN` is byte-identical
(md5 `58df92b2...`) to `STRATEGY/SOKO/SOKO.TXT`. That is the readme of Allan
Liss's *other* Sokoban, and it says "You are looking at the file SOKO.TXT". The
compilers of the CD put the wrong file there. The level format is only in the
VB3 p-code, so there is nothing to put back without inventing data. Real Windows
would show the same empty board.

```
node test/run.js --exe=<dir>/SOKOBAN.EXE --vfs-include='*' \
  --win16-lib=<dir>/VBRUN300.DLL --max-batches=20000 --no-close --quiet-api \
  --input=8000:click:52:51,9000:click:63:72 --trace-fs --png=sok.png
```

## MicroMan (`ARCADE/MICROMAN`)

16-bit NE, and it needs nothing: `--max-batches=40000` off the CD directory
draws the full game — menu bar, tiled level, sprite and the status strip.

## Pitfall (`ARCADE/PITFALL`, open)

32-bit PE. It greets you with "Pitfall must be played in 256 color mode for
optimum performance." (`MB_ICONERROR`, OK only), and then asks for
**DISPDIB.DLL** — the Video for Windows full-screen DIB driver — through
`LoadModule`, a KERNEL32 API we did not implement, so the run ended in
`FATAL: implement this API`.

`LoadModule` is implemented as of 2026-09-20 and answers what Windows answers
for a module that is not on the machine: 2, `ERROR_FILE_NOT_FOUND`. Pitfall
turns that into its own diagnostic —

```
[MessageBox] "Pitfall": "Bad or missing dispdib.dll - error 2"
```

— and exits. So it has no GDI fallback: reaching gameplay needs a DISPDIB
surface, the same shape as the MPR/TAPI/spooler fragments (a small WAT-native
module behind `DisplayDib`/`DisplayDibWindow`, presenting a 320x200 8bpp DIB
full screen). The one copy of the real DLL in this tree,
`test/binaries/candidates/civilization-2-win16/cd/VFW_INST/DISPDIB.DL_`, is
**KWAJ**-compressed, not SZDD, so `tools/szdd.js` cannot expand it — and it is
a 16-bit DLL besides, which a 32-bit caller cannot load without thunks we do
not have. Implementing the surface is the route, not finding the file.

### What Pitfall actually wants from DISPDIB

Read statically from `PITFALL.EXE` on 2026-09-20, so the API list below is what
the loader really does, not what the DISPDIB documentation describes. The
loader is the function at **`0x0044104e`**:

1. `GetSystemDirectoryA(buf, 260)`, then appends the literal `\DISPDIB.DLL`
   from `0x0046df38` — so the path it tests is
   `C:\WINDOWS\SYSTEM\DISPDIB.DLL`, not a bare name.
2. `LoadModule(path, &block)` at `0x00441055`. `cmp eax,0x20 / jl` — anything
   below 32 is the failure that produces "Bad or missing dispdib.dll - error 2".
3. `CreateWindowExA(0, "DisplayDibWindow", …, WS_POPUP, 0, 0, cx, cy, …)` at
   `0x004410e1`, sized from two `GetSystemMetrics` calls. **`DisplayDibWindow`
   at `0x0046df24` is a window class, not an exported function** — the whole
   surface is driven through that window, which is why no `GetProcAddress`
   appears anywhere in the trace. The HWND is kept at `0x0046c3a0`.
4. `SendMessageA(hwnd, WM_COPYDATA, 0, &cds)` at `0x00441175`, with
   `dwData = 0x400`, `cbData = 0x428` and `lpData` pointing at a
   `BITMAPINFOHEADER` filled in at `0x0044111d`: `biSize=0x28`,
   `biWidth=320`, `biHeight=200`, `biPlanes=1`, `biBitCount=8`. `0x428` is
   `0x28 + 0x400`, i.e. the header plus 256 `RGBQUAD`s — so this one message
   carries both the mode and the palette.

The HWND at `0x0046c3a0` is read in exactly three places, so the whole
protocol Pitfall uses is three sends:

| site | send | meaning |
|---|---|---|
| `0x00441175` | `WM_COPYDATA`, `dwData=0x400` | set 320x200x8 + palette |
| `0x0044123d` | `0x403` | start |
| `0x00441442` | `0x404` | stop |

**What is still unknown is how a frame of pixels gets there**, and it is not
answerable statically — no fourth send exists, so the bits either come back as
a pointer from one of these sends or go through an ordinary GDI call on that
window. The flag at `0x0046c3dc` ("DISPDIB is available", set at `0x00441181`)
is *not* the answer: its three readers are all in the dialog code at
`0x0044072c`, choosing a control layout.

### The surface, and what the runtime then said

Built 2026-09-20 as `src/09d5-dispdib.wat`: `$handle_LoadModule` answers a
module handle for any path whose basename is `dispdib.dll`, `CreateWindowExA`
claims the class name `DisplayDibWindow` onto a new WAT-native wndproc marker
(`0xFFFF0005`), and that wndproc implements the three sends above over a small
`$DISPDIB_STATE` record. Every *other* private message traps by name, which was
the point: the fourth send, if there is one, would say so rather than be
guessed at.

**There is no fourth send.** Pitfall runs the whole handshake — LoadModule,
`CreateWindowExA(… "DisplayDibWindow" … 640x480 WS_POPUP)`, one `WM_COPYDATA`
with `dwData=0x400` — and never touches that HWND again, over 200,000
batches. Nothing trapped. It then **plays in its own window**: the title
screen with its File/Help menu, and `File > New Game` (`post-cmd:40036`) runs
the 2600-style attract demo, drawn with ordinary GDI into the 320x224 client
area and a status strip underneath.

So DISPDIB here is a *capability probe with a mode attached*, not the path the
pixels take. The 0x403/0x404 pair is the full-screen switch, which a headless
run never asks for; the flag at `0x0046c3dc` choosing a control layout is
consistent with that reading. Reaching gameplay needed the surface to exist
and answer, not to display anything.

```
node test/run.js --exe=/Volumes/1000GAMES/ARCADE/PITFALL/PITFALL.EXE \
  --vfs-include='*' --quiet-api --max-batches=200000 --max-seconds=50 \
  --no-close --input=3000:dlg-cmd:1,20000:post-cmd:40036 --png=pitfall.png
```

(`3000:dlg-cmd:1` is the OK on the 256-colour notice; without it the run parks
on the modal at batch 14.)

Two things this does not fix. A program that *stats* `DISPDIB.DLL` rather than
loading it still finds nothing there — the same gap Bad Toys 3D hits with
`wing.dll`, and the reason that one needs a file and not a module answer. And
a full-screen 320x200 presentation is still unimplemented: the wndproc records
the mode and the running flag, and the first program to actually start the
display will trap on whatever it sends next.

There is no fallback path to find, either: Pitfall exits when the module is
missing rather than degrading to GDI. Regression:
`test/test-dispdib-window.js`.

## Exile II: Crystal Souls (`ADV/EXILE`)

Reaches its title screen as of 2026-09-20. Getting there is a **three-stage**
run, because nothing on the CD is the game: `INSTALL.EXE` is a bootstrapper,
the installer it starts is a second program, and only that one writes the game.

```bash
# 1. the bootstrapper: unpacks IRDATA.DAT + IRSETUP.EXE into C:\WINDOWS and
#    WinExec's the second, which --capture-launch snapshots instead of losing
node test/run.js --exe=/Volumes/1000GAMES/ADV/EXILE/INSTALL.EXE \
  --vfs-include='*' --quiet-api --no-close --max-batches=30000 \
  --capture-launch=/tmp/exile-stage2

# 2. the real installer. --exe-guest-path is load-bearing: IRSETUP finds its
#    configuration next to its own module, and without it the module reads as
#    C:\IRSETUP.EXE and the config lookup goes to C:\IRDATA.DAT, which is not
#    where stage 1 put it -- "Could not load the configuration file."
node test/run.js --exe=/tmp/exile-stage2/windows/irsetup.exe \
  --exe-guest-path='C:\WINDOWS\IRSETUP.EXE' --args='C:' \
  --vfs-tree=/tmp/exile-stage2 --cwd='C:\' --overlay-dir=/tmp/exile-overlay \
  --quiet-api --no-close --max-batches=120000 --input='3000:click:281:349'

# 3. the game, out of the overlay the installer wrote
node tools/overlay-export.js /tmp/exile-overlay --out=/tmp/exile2 --prefix='c:\exile2'
node test/run.js --exe=/tmp/exile2/exile2.exe --vfs-tree=/tmp/exile2 \
  --quiet-api --no-close --max-batches=200000 --input='6000:click:480:427'
```

Stage 2 installs 37 files (6.8 MB) into `C:\EXILE2`. Stage 3 draws the welcome
text, and one click on "On with the game..." reaches the title screen with the
animated map panel and the five-item menu.

Four emulator gaps were in the way, and the first is the interesting one:

- **`GDI.76` was wired to `SetBitmapBits` and is `GetBkMode`.** The real GDI
  export table (`src/win16-ordinals.generated.json`, which the `--trace-win16`
  decoder already prints from) says 74 `GETBITMAPBITS`, 76 `GETBKMODE`, 106
  `SETBITMAPBITS`. IRSetup's painter reads the background mode back while
  drawing its text, so the bitmap path ran instead and fed a stack word to
  `$win16_h32`, which correctly refused a handle it never handed out. **The
  generated ordinal map is ground truth for this kind of bug** — a wrong
  ordinal looks exactly like an unimplemented one until the two are compared.
- `USER.181 SetSysColors` did not exist in either bitness. It does now, backed
  by `USER_SYS_COLORS`, a 32-slot override table `GetSysColor` reads ahead of
  the stock palette (`test/test-set-sys-colors.js`). The 16-bit form is not the
  32-bit one: its index array is 16-bit and its value array 32-bit, so the
  Win16 entry walks the pair itself rather than forwarding.
- `GDI.373 SetSystemPaletteUse` and `GDI.60 CreatePatternBrush` needed only
  their Win16 wrappers; both Win32 handlers were already there.

Two things to know before the next installer:

- `--capture-launch=DIR` plus `--vfs-tree=DIR` is the two-stage bootstrapper
  route, and `--overlay-dir=DIR` plus `tools/overlay-export.js` is how the
  *installed* tree comes back out as ordinary files.
- Stage 3 runs at ~138 batches/s, two orders of magnitude below a typical app.
  The title screen animates, so that is drawing cost, not a hang.

## Bad Toys 3D (`3D/BT3D19`, installs and runs)

**2026-09-20: it installs and the game runs.** Everything below this box was
written when it stopped at the first message box; it is kept because each step
is still the right description of that step. What changed is four gaps, all in
`a6282f44`, plus the recipe.

The whole route, from the CD directory:

```bash
W=<...>/3d-bt3d19
# stage 1: the bootstrap installer. Ok on the directory dialog.
node test/run.js --exe=$W/INSTALL.EXE --vfs-include='*' \
  --win16-lib=$W/WING/WING.DLL --max-batches=120000 --max-seconds=120 \
  --no-close --quiet-api --capture-launch=/tmp/bt3d-stage1 --input=5000:click:231:291
# stage 2: what it WinExec()s -- itself, copied to C:\BT3D\TINST.DAT.
node test/run.js --exe=/tmp/bt3d-stage1/bt3d/tinst.dat --args='/kopie C:\' \
  --vfs-tree=/tmp/bt3d-stage1 --win16-lib=$W/WING/WING.DLL --cwd='C:\' \
  --max-batches=400000 --max-seconds=120 --no-close --quiet-api \
  --save-vfs=/tmp/bt3d-game
# the game: BT3D.EXE (178,944 bytes) and DATA.PCK (2.4MB) are now real files.
node test/run.js --exe=/tmp/bt3d-game/bt3d.exe --vfs-include='*' \
  --win16-lib=$W/WING/WING.DLL --max-batches=200000 --max-seconds=90 --no-close
```

`--win16-lib` is the answer to the WinG file test below: it both mounts a file
at `c:\windows\system\<name>` and puts it in the NE loader's search path, so
the CD's own `WING.DLL` is the real module rather than a stub, and WinG loads
as an ordinary 16-bit DLL. No WAT-native WinG was needed.

The four gaps, in the order the run hits them:

- **`USER.308 DefDlgProc` was not dispatched.** The paragraph below reads it as
  needing the far-continuation path; it does not. On this side a dialog's
  window is ours, and `$win16_DefWindowProc` already routes a message for one
  into the native dialog path and already ends the dialog on an IDOK or
  IDCANCEL the dialog procedure declined — that is exactly what a task
  subclassing a dialog gets back, and calling `DefDlgProc` by ordinal is the
  same request spelled differently. 308 forwards to it. The setup dialog draws
  and its Ok button works.
- **A 16-bit task never saw its command line.** `$win16_InitTask` built the PSP
  block unconditionally empty. `INSTALL.EXE` copies itself to
  `C:\BT3D\TINST.DAT` and `WinExec()`s it with `/kopie C:\`, so with an empty
  PSP the second stage read no switch and put the directory dialog up again.
  This was never Bad Toys' bug alone: **no** 16-bit task has ever been handed an
  argument here.
- **`waveOutGetVolume` read past its own frame.** The waveOut shim hoisted the
  `HWAVEOUT` out of stack word 3 for every ordinal reaching that point, but 415
  and 416 take `(uDeviceID, ...)` in a six-byte frame. `$win16_h32` refused the
  caller's leftover word (`0x5307`) and killed the task on a call that was
  otherwise implemented and correct.
- **MMSYSTEM 101-107 and GS.** The joystick set now forwards to the 32-bit
  handlers, which already answer for a machine with no joystick driver. GS is
  an ordinary selector in a 16-bit task, resolved through `WIN16_SEG_TABLE`
  like FS; this game keeps a data selector there.

**2026-09-20, later: it plays its attract-mode DEMO** (the 3-D view, HUD and
weapon all draw; 40,000 batches, no trap). Two more gaps, neither of them
Bad Toys-specific:

- **The SIB scale was dropped in 16-bit segments** (`00f9f44d`). The game is
  Borland Pascal with 386 code, and its raycaster reads a 900-entry tangent
  table (`FS=02cf:0000`, tan((i+0.5)·0.1°) in 16.16, which is exact) with
  `fs: mov edx,[edi+ecx*4]`. `$ea16_info` never packed the scale, so that was
  `[edi+ecx]`, a misaligned blend of two entries. A ray given those slopes
  walked out of the fully walled 64x64 map and `or word [si+0x4616],0x4400`
  marked words past it, and one of them was the accelerator handle, which is
  how `0x110` became the `0x4510` handed to `TranslateAccelerator` at ~18,300
  batches. So the "what overwrote it" question above had a decoder answer.
- **A statically imported NE DLL never ran its LibEntry**; only
  `LoadLibrary` did. WinG's LibMain (entry `16:0x336`) is what binds
  `GDI.489 CreateDIBSection` through `GetProcAddress`. Without it
  `[WING DS:0x2412]` stays 0, so `WinGCreateDC` becomes `CreateCompatibleDC(0)`
  and `WinGCreateBitmap` becomes `CreateCompatibleBitmap`, a DDB with no bits
  pointer, and the column drawers in seg 30 (`les di,[0x1712]`) write
  through NULL. `lib/dll-loader.js` now queues every static import
  dependencies-first, and `win16_begin_dll_inits` runs each LibEntry
  (`DI`=hInstance, `DS`=its DGROUP, `CX`=heap size, `ES:SI`=0) before the
  task entry, on the task's stack, restoring the task's registers afterwards.
  A LibEntry that returns 0 traps with marker `0xCA16D1F0` and the module id:
  Windows would refuse to start the task.

  That also changed WEPUTIL, the Entertainment Pack's shared DLL: its LibMain
  now sees `NUMCOLORS=256` and picks its 4-bpp colour About logo (`666`)
  instead of the monochrome `999`. The About-panel emboss in
  `$win16_BitBlt` is gated on a 1-bpp source now; before that gate it
  painted the face and frame and embossed nothing.

16-bit NE `INSTALL.EXE`, and it never gets as far as unpacking anything:

```
[MessageBox] "BAD TOYS 3D Setup": "WinG is not installed,
```

The check is a file test, not a load. `--trace-fs` shows
`GetSystemDirectory` then `OpenFile` on `C:\WINDOWS\SYSTEM\wing.dll`, and the
message box follows the miss immediately — no `LoadLibrary`, no
`GetProcAddress`. The CD carries the WinG redistributable in `BT3D19/WING/`
(the Microsoft ACME `MSSETUP.EXE` kit: `WING.DL_`, `WING32.DL_`,
`WINGDIB.DR_`, `DVA.38_`, `WING.MST`), so on real hardware you run that first.

Mounting any file at that path with
`--vfs-mount=<host file>=c:\windows\system\wing.dll` gets past it — the
installer then builds its main window and a 7-control dialog and stops at the
**next** gap, `USER.308 DefDlgProc`, which we do not have in 16-bit form.

That one is not a small wrapper. `$handle_DefDlgProcA` reaches dialog default
processing through `$dialog_default_proc`, which calls `$wnd_send_message` —
the 32-bit synchronous sender — and can also tail-dispatch a stored proc by
writing `$eip` over a 32-bit frame. Neither is right for a Pascal caller, so a
truthful `USER.308` wants the Win16 far-continuation path rather than a
forward. As of 2026-09-20 that area is claimed on the message board by another
agent (Win16 windowpos/defproc, far continuation), so this is blocked on
coordination and not on knowledge.

Two things to settle before that matters, in this order:

1. **WinG itself.** Eight entry points — `WinGCreateDC`,
   `WinGRecommendDIBFormat`, `WinGCreateBitmap`, `WinGGetDIBPointer`,
   `WinGGet/SetDIBColorTable`, `WinGBitBlt`, `WinGStretchBlt` — all of which
   sit on DIB machinery `10a-gdi-bitmap.wat` and `10g-gdi-raster.wat` already
   have. The shape to copy is `09d1-mpr.wat`/`09d2-tapi.wat`: a WAT-native
   module answered for by name, plus whatever makes a file test at
   `c:\windows\system\wing.dll` succeed, since that test is what the installer
   actually performs.
2. **Which entry points `BT3D.EXE` needs.** Unknown, because the exe is inside
   `DATA.TCF`/`BT3D.TCF` and only the installer unpacks them. Get past
   `USER.308` with the mounted-stub trick first and dump the installed exe's
   imports; do not size the WinG work from the API list before then.

## ClockWerx (plays; 174e790f, fbb6d7bb)

16-bit, and the loader says it first:

```
[win16] loaded MAC2WIN as module 13
[win16] loaded WING as module 14
[win16] DISPLAY: no DLL found, imports from it will stop the task
```

It imports from `DISPLAY` — the Windows display *driver* — and dies at batch 1
with `EIP=0`, `EAX=0x4C01` and 16-bit selectors still in the registers. This is
a driver surface we do not have, not a missing USER/GDI entry point. Its CD
directory is already fully expanded apart from `AAA._`, `DVA.38_` and
`WINGPAL.WN_`, so the SZDD trick above does not apply.

**2026-09-20: `DISPLAY` is a red herring, and so is the 256-colour check.**

The import is not ClockWerx's at all — `CLOCKWRX.EXE` names KERNEL, GDI, USER,
WIN87EM, WING, MAC2WIN, COMMDLG and MMSYSTEM, and it is **WING.DLL** that
imports `DISPLAY.#1` (the driver's own `BitBlt`, for its fast path).
`lib/dll-loader.js` now lists `DISPLAY` among the emulated modules, so the name
resolves to a thunk and the Win16 dispatcher's fail-fast tail would report
`DISPLAY.1` if it were ever entered. **It never is**: with and without that
change the `--trace-win16` log is the same 152 lines apart from the
"no DLL found" line itself, and the task exits at the same batch either way.
The change is worth keeping — an unresolved fixup is a landmine and this turns
it into a named crash — but it is not what stands between ClockWerx and a
window.

What the task actually does, in order: `MAC2WININIT`, `GetDC` +
`GetDeviceCaps(BITSPIXEL)` + `GetDeviceCaps(PLANES)` +
`GetSystemPaletteEntries(256)`, WinG ordinal 1002, MAC2WIN's `PixelSize`,
`LoadCursor`/`LoadIcon`/`RegisterClass`, `InitSoundMusicSystem` with
`midiOutGetNumDevs`/`midiOutGetDevCaps`, a second `RegisterClass`, a
`SoundMusicSys` window, `waveOutOpen`, several song buffers — and then
`GetIndString(STR# 128, index 10)` through `FindResource`/`LoadResource`,
after which it tears everything down in order (`FinisSoundMusicSystem`,
`waveOutClose`, `DestroyWindow`, `timeEndPeriod`, `Mac2WinUninit`) and exits
with code 1 via `INT 21h AX=0x4C01`. **No `MessageBox` is ever called**, so the
string it fetched is never shown.

The colour-depth check is ruled out by measurement, not by reading: with
`GetDeviceCaps(BITSPIXEL)` temporarily answering 8 instead of 32, the run is
identical — same exit, same batch. (The image does carry both of the strings
that check would print, at file offsets `0x2be06` and `0x2c5d0`.)

So the next step is the string: at the return from `GetIndString` the
destination buffer is still zeros, which says either the copy happens after
that point or the list lookup came back empty. Note the strings in this image
are *not* a packed Mac `STR#` — they are Pascal strings in fixed slots — so
whatever index 10 resolves to has to be read out of the resource at runtime
rather than counted in the file.

**Later 2026-09-20: it plays.** Six separate things stood between the exit
above and a moving board, and none of them was the string itself.

1. **Run it from an installed layout, not the CD directory.** WinG's LibMain
   checks that WING.DLL was loaded from the system directory and refuses to
   start otherwise. Once fe4d1e76 made a static import's LibEntry actually run,
   that check fired as a LibEntry returning 0 (`0xCA16D1F0`). The emulator was
   right: with the whole CD directory mounted as the game directory, the loader
   finds `C:\WING.DLL` next to the exe, just as Windows would. The fix is the
   install shape: copy the game's own files into a directory of their own
   (`CLOCKWRX.EXE *.BMP *.BIN CWDMUSIC.DLL CWXLEVEL.DLL MAC2WIN.DLL
   SD2SOUND.DLL SONG*.MID`, after the SZDD expansion) and supply WinG with
   `--win16-lib`, as Bad Toys 3D does.
2. **`LoadResource` returns a selector** (fbb6d7bb). MAC2WIN's `GetIndString`
   calls `GlobalLock` on the `hResData` handle, which is legal in Win16. The
   resource used to be loaded lazily inside `LockResource`, so `GlobalLock` got
   a handle it could not resolve, the copy came back empty, and the game quit.
   `$win16_res_load(desc)` now loads at `LoadResource` time and returns the
   segment's selector. `LockResource` and `GlobalLock` both give `sel:0000`,
   and `FreeResource` finds the descriptor by its selector. The trace went from
   87 calls to 129.
3. **MMSYSTEM timers**: `timeGetDevCaps` (604), `timeSetEvent` (602) and
   `timeKillEvent` (603). The game sets six of them. A due 16-bit TimeProc is
   entered from the task's own `PeekMessage`/`GetMessage` with a FAR PASCAL
   frame that returns into that pump call. GDI.445 `CreateDIBPatternBrush` and
   GDI.78 `GetCurrentPosition` came next. After these the title screen draws
   at 640x480.
4. **A USE32 code segment** (fbb6d7bb). NE segment 1 is a 0x35d-byte 32-bit
   blitter. On first use the game fetches its descriptor with DPMI `int 31h`
   000Bh, sets D (`or byte [desc+6],40h`), and writes it back with 000Ch. From
   then on the segment runs as 32-bit code: 32-bit operands and addresses by
   default, rel32 branches, and `66 CA` for its 16-bit far return. Without
   this, int 31h failed, the probe after it looped, and a click on the title
   screen did nothing. The segment flag is `WIN16_SEG_BIG`, `$cs_big` is the
   decode-time switch, and `$use32_gap` (`0xCA163200`) names the first
   program that makes a 32-bit far transfer out of such a segment.
5. **The USER caret family** (163-169 and 183) and USER.21
   `GetDoubleClickTime`. The Options screen's name field creates a caret, and
   the second click asks for the double-click time.
6. **DDBs are stored top row first** (174e790f). The level names are rendered
   through a monochrome DDB built from raw bits, and they came out upside down
   until `$gdi_bitmap_plan_create_bitmap` marked the plan top-down.

After Play the screen stays black for about 2000 batches with no API calls.
That is level loading in the game's own code (CS=0x27), not a hang.

**Reaching gameplay headless** (`$D` is the expanded CD directory, `$I` the
installed copy from step 1):

```
node test/run.js --exe=$I/CLOCKWRX.EXE --vfs-include='*' \
  --win16-lib=$D/WING.DLL --win16-lib=$D/WINGDIB.DRV \
  --max-batches=8800 --stuck-after=100000 --no-close --quiet-api \
  --input=3500:click:320:300,3720:click:318:403,6100:keydown:88,6110:keyup:88 \
  --png=clx.png
```

The click at 3500 leaves the title for Options. Play at (318,403) starts the
Stage 1 tutorial, and X at 6100 dismisses "Welcome to Stage 1 DEMO". By batches
8200-8800 the clock hands on the board are animating. Another X at 9000 resets
the board. `--stuck-after` has to be raised, because the title screen idles in
a blocking wait long enough to trip the detector.

Still open, and cosmetic: some narrow glyphs are missing from the Options
screen's level list ("Wa s", "D zz ness", and "Goa  Dot" without its `l`).
Only the narrowest letters (i, l) drop, which points at glyph width in
whatever text path draws that list. That path has not been traced yet.
