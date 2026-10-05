# Fuji Golf (Win16 WEP3)

App `wep16_fujigolf`, `test/binaries/wep16/WEP3/FUJIGOLF.EXE`, with
`FUJIGOLF.DAT` mounted beside it. See the historical native comparison in
[win16-v86-audit.md](../win16-v86-audit.md).

## 2026-09-20: separate startup harness failure from clubhouse geometry

The previous WEP3 gate failed to find player-name edit ID 100. A screenshot
at its clubhouse checkpoint instead shows the game's legitimate first-run
prompt asking to copy `C:\FUJIGOLF.DAT` to `C:\WINDOWS\FUJIGOLF.DAT`.
The test had not accepted it. HWND 0x10001 is that message box, not the
player dialog; no missing edit-control implementation is established.

Accepting the prompt at batch 20 opens the maximized clubhouse. Its Start
New Round button is ID 4, parent HWND 0x1000b in this run, child position
(113,331), size 187x19. Its visible screen center is around (210,382), not
the old test's (220,409). Clicking it opens the player dialog, accepts
`Codex` in edit 100, and OK reaches the rendered first tee. The course
screenshot was visually inspected, including golfer, course overview,
clubs and shot controls.

The corrected gate accepts the copy prompt and uses `ctrl-click:4`, which
resolves the real control independently of layout. It retains the strict
maximized-caption and native scene-depth checks, and checks the course
transition before those geometry checks. **The gate remains red**, now for
the actual scene-height problem: saturated content bounds **360x291**,
against the retained height requirement >310. The historical native scene
is 368x326. Do not lower the threshold or call Fuji Golf fully fixed.

Runtime code is unchanged by this investigation. The next investigation is
the guest's clubhouse layout/bitmap sizing (including the synchronous
maximize size and client dimensions), not the name-entry dialog or painting
callbacks. The current clubhouse is maximized, but its scene remains short.

Evidence, all in `/private/tmp/`:

- `wa-fuji-repro.log`, `wa-fuji-clubhouse.png`: original failure and prompt.
- `wa-fuji-first-run.log`, `wa-fuji-ready.png`: prompt accepted, clubhouse
  and actual button geometry; old click still misses.
- `wa-fuji-round.log`, `wa-fuji-course2.png`: corrected physical click,
  successful name entry and first tee.
- `wa-fuji-corrected-gate.log`: corrected control-ID recipe reaches the
  unchanged scene-depth assertion.

```sh
WINE_ASSEMBLY_WASM=build/wine-assembly.wasm node test/test-win16-wep3-gameplay.js fujigolf
```

## 2026-09-20: geometry cause isolated to missing Win16 activation

`wa-fuji-layout-trace.log` records ShowWindow(SW_MAXIMIZE), followed by the
clubhouse's synchronous WM_SIZE. The guest calls GetActiveWindow at runtime
0x0014229a and receives zero at 0x0014229f. The handler's size lParam is
0x01b20278 (632x434), so the maximized dimensions themselves are available.

Disassembly of **NE segment 5:0x229a** shows the gating condition:

```text
GetActiveWindow()
cmp ax, [DS:986c]       ; clubhouse HWND
jnz 22b2               ; skip layout, chain to DefWindowProc
push [bp+8]
push [bp+6]            ; size arguments
call far movable entry 0xc5
```

In this load, segment 5 is at 0x00140000 and DS is selector 0x005f.
Reproduce the disassembly with:

```sh
node tools/ne-disasm.js test/binaries/wep16/WEP3/FUJIGOLF.EXE 5:0x229a 55
```

The shared GetActiveWindow correctly reads `active_hwnd`; its Win16 adapter
delegates and narrows the handle. Win16 ShowWindow, however, only promotes
`main_hwnd`, never updating active state before its synchronous size callback.
Those globals are not interchangeable. The earlier main-window promotion
comment no longer describes sufficient behavior under the shared active-
window implementation.

An isolated full-source artifact sets `active_hwnd = hwnd` immediately
before `win16_show_continue`, **only for SW_MAXIMIZE as a diagnostic**.
`/private/tmp/wa-fuji-active-probe.wasm` passes the unchanged full geometry/
round gate (`wa-fuji-active-probe.log`). Its clubhouse screenshot
`wa-fuji-active-probe.png` was visually inspected: the scene is full-height
and centered, with buttons below it. No bitmap, metric or pixel-test change
was needed. Main runtime remains unchanged and the shipping gate stays red.

**Do not integrate this bare assignment.** It proves the missing state is
causal, not that activation is correctly implemented. The production fix
needs a Win16-safe activation transition: show-mode eligibility (including
no-activate modes), top-level selection, far WM_ACTIVATE notifications,
state visible during callbacks, nested activation/destruction safety and
focus handling. The existing Win32 `active_window_transition` sends through
its synchronous message path; it cannot be assumed safe for far callbacks.

Official documentation says [SW_MAXIMIZE activates the window](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)
and [GetActiveWindow reads the calling queue's active window](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getactivewindow).
These support the state contract, not an exact Win98 notification-order
claim; that order still requires dedicated far regression/native evidence.

## 2026-09-20: activation implementation verified

The main-source implementation now uses the FFB4 stack-owned activation
continuation, not the diagnostic assignment. Activating show modes publish
queue state, notify old/new windows with Win16 argument packing, and complete
focus processing before the synchronous show-size callback. Nested activation
and destruction are covered by the real far regression, including calling
GetActiveWindow from WM_SIZE. Nonactivating modes and child shows retain the
previous active window.

Fuji's full gate passes with the completed normal build, including the
unchanged native-depth check and first-tee transition. Full verification and
the related Klotski EnableWindow repaint-loop correction are recorded in
[the review findings](../review-win16-windowpos.md). This supersedes the
earlier shipping-red status above; it does not close the remaining ShowWindow
hide/minimize selection, application-activation scheduling or return-value
gaps.

## 2026-09-20: explicit host foreground exposes missing show publication

Replacing the host's highest-z-order inference with an accepted foreground
record made the unchanged clubhouse caption check fail (blue width zero),
while the course transition still worked. `wa-foreground-fuji-trace.log`
shows the clubhouse ShowWindow(3) and full-height child layout, but no
`activate_window` call; `foreground_window` remained zero. This is separate
from the earlier missing guest `active_hwnd` state.

The far ShowWindow continuation now explicitly publishes the surviving
accepted target after activation/focus callbacks, before size/erase work.
Its pending bit is invocation-owned; child/no-activate modes do not publish,
and nested activation or destruction cannot restore the superseded target.
The test's dimensions, colour predicate and gameplay recipe are unchanged.

The completed clean build passes all seven WEP3 games, including Fuji's
original maximized-caption, scene-depth and first-tee checks:
`/private/tmp/wa-accepted-foreground-wep3-final.log`. Normal/compat artifacts
are 1454060/1454966 bytes, layout `c5ccefca8909ee4b`.
