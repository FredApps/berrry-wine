# Winamp wVis popup routing

## Binary and guest path

`test/binaries/plugins/candidates/vis_w.dll`, preferred image base
`0x10000000`, SHA-256
`45505bb5e232c5f28b2ef0223ecf2c2103e4800a0c02276c0c6fbf6638bcd7c6`.
Addresses below are original image VAs, not relocated runtime addresses.

The window procedure compares its message with `WM_RBUTTONUP` (0x205) at
`0x10002a9f`, branching at `0x10002aa5` to `0x1000302b`. That arm gets
GWL_USERDATA, reads the instance from offset 8, loads menu resource 101,
gets the cursor position and updates check marks from plugin state.
It calls `GetSubMenu(menu, 0)` at `0x1000321e`, `TrackPopupMenu` at
`0x1000322b`, then `DestroyMenu` at `0x1000322e`.

Relevant USER32 IAT slots:

| Original VA | Import |
| --- | --- |
| 0x1000f2fc | LoadMenuA |
| 0x1000f308 | GetSubMenu |
| 0x1000f30c | GetCursorPos |
| 0x1000f310 | CheckMenuItem |
| 0x1000f318 | TrackPopupMenu |
| 0x1000f31c | DestroyMenu |

Use `tools/pe-imports.js --dll=USER32.DLL`, `tools/find_bytes.js --imm32=0x205`,
and `tools/disasm_fn.js` at the instruction-aligned addresses above. This
is evidence from the shipped guest DLL, not Wine source.

## Browser experiment, 2026-09-21

The existing `test/test-winamp-visualization-web.js` regression passes after
`a72cd571`: Preferences → wVis → Start/Stop/Start → playback → right-click →
Rendering Options hover. Baseline log:
`/private/tmp/wa-wvis-menu-baseline.log` (terminal exit 0).

Disabling only `_openWorkerContextMenu` in the isolated browser test copy
still opens the guest popup and exposes Rendering Options, but the old
fixed hover at y=228 fails the submenu assertion. Log:
`/private/tmp/wa-wvis-menu-no-helper.log` (terminal exit 1). The screenshot
shows a different popup anchor; do not interpret this as failure to deliver
WM_RBUTTONUP or failure to create the popup.

Follow-ups at y=257 still fail (terminal exit 1):
`/private/tmp/wa-wvis-menu-native-hover.log` and
`/private/tmp/wa-wvis-menu-hit-probe-json.log`. The latter uses the existing
profile tool's `eval:` step, with `JSON.stringify` because the tool converts
eval results to strings. The preserved result is
`/private/tmp/wa-wvis-native-menu-result.json`. Direct exports report:

```text
owner                 98305
dropdown x/y/width    149 / 204 / 180
child flags           [2,1,1,1,1,1,1,1,1,1,1,1]
hit-test (215,257)     -1
hover (215,257)        -1
```

These are internal blob flags: bit 0 means separator, bit 1 means grayed,
bit 2 checked, bit 3 popup. Child 2 has the correct label "Rendering Options"
but flag 1: the hit test deliberately rejects it as a separator. Every item
after the title is similarly flagged. This rules out coordinates or browser
mousemove routing as a sufficient explanation: calling the WAT hit test
directly at an interior point also fails. It does **not** yet establish which
parser/mutation/ownership path produced those flags. Trace API names were
added, but the retained console events contained no menu API entries; do not
present the static call sequence above as a captured runtime API trace.

Next diagnostic: compare the raw resource and the first installed menu blob
with its later state, then isolate the write that first turns a labelled
popup into a separator. Preserve this failure as a regression before deleting
the renderer helper. No runtime behavior was changed in this investigation.

There is also a separate lifetime gap: our TrackPopupMenu handlers return
immediately after opening the popup, allowing the guest's subsequent
DestroyMenu to run before selection. Microsoft's
[TrackPopupMenu contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-trackpopupmenu)
and [menu-loop example](https://devblogs.microsoft.com/oldnewthing/20050307-00/?p=36263)
describe selection tracking before return. That source-level gap is not yet
proven to cause the observed flags; do not fix it by silently ignoring menu
destruction, and do not claim a native Win98 measurement from modern docs.

The renderer workaround discovers the plugin by window title and DLL export
name, opens resource 101 itself, manually synchronizes allocator globals,
and consumes the real button-up. It therefore bypasses the guest's own menu
setup/check-state path. The replacement must preserve guest delivery and
submenu usability, not merely draw a lookalike resource menu.

## Separator-state fix, 2026-09-21

The bad transformation was `$dynamic_menu_make_popup_blob`, not the resource
parser. Detached LoadMenu/GetSubMenu produces a MNUD tree; MF_POPUP items
correctly store their HMENU in the submenu field and have command id zero.
The tracked-popup serializer then classified every zero id as a separator
and unconditionally wrote child offset zero. All the labelled rows after the
title in this resource are submenus, explaining the exact flag pattern.

Tracked popups now use `$dmb_measure` / `$dmb_write_block`, the existing
recursive dynamic-menu serializer, with one synthetic bar record. This
removes the duplicate flat serializer. The shared writer preserves the
owner-draw marker and never interprets owner-draw data as a text pointer;
the removed diagnostic `#hhhh` fallback for nontext items is not retained.

Validation:

- `test-menu-popup-text.js`: 12 checks pass on main and the isolated copy.
  Added submenu labels, ids, checked state, separator, hit-test and owner-draw
  assertions. Restoring HEAD's previous menu source through the test compiler
  makes the new separator assertion fail (`1 !== 0`), recorded in
  `/private/tmp/wa-wvis-popup-negative.log`.
- Isolated owner-draw, nested-resource-mutation, detached-menu-handle,
  dynamic-menu-bar and menu-item-rect suites pass.
- Isolated full build passes: layout `c5ccefca8909ee4b`, wasm 1454564 bytes,
  compat 1455470 bytes; `/private/tmp/wa-wvis-recursive-popup-build.log`.
- Rebuilt real-browser test with the helper disabled passes, terminal exit 0:
  `/private/tmp/wa-wvis-recursive-popup-browser.log`. The same direct probe
  reports flags `[2,1,0,1,0,0,0,0,0,0,0,1]`, hit 2, hover 2. Rendering Options
  exposes all 12 expected submenu entries. Screenshot visually inspected;
  visualizer content, highlighted parent and cascade are visible.

The title-matched renderer helper is still installed in production. Removing
it, proving command selection/check-state changes and fixing TrackPopupMenu's
premature return remain open. The shared serializer's existing two-level
child-depth limit is unchanged; this is not proof of arbitrary-depth menu
tracking or native Win98 modal-loop fidelity.

## Check-state setup, 2026-09-21

The guest calls CheckMenuItem on the LoadMenu handle before GetSubMenu and
TrackPopupMenu. For example, original VA `0x10003065` checks command
`0x9c74 + [0x1000c0bc]`; the branches beginning at `0x10003078` select a fade
command from `[0x1000c0a8]`. The old CheckMenuItem handler ignored dynamic and
detached handles and scanned only window-attached menu blobs. Thus the guest
could not check this detached tree before displaying it.

Added a canonical dynamic-tree check operation. Position targets exactly one
item on the specified menu; command lookup descends into submenus and stops
at the first matching command. It preserves unrelated state bits and returns
the previous check state, or -1 for a missing item. Tagged detached LoadMenu
handles resolve to their existing canonical tree. The behavior follows the
[CheckMenuItem contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-checkmenuitem)
and Microsoft's [menu item addressing description](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/menurc/about-menus.md).
These are documentation references, not new native Win98 measurements.

The compiled regression passes 13 checks on main and the isolated copy,
including nested commands, repeated checks/previous-state returns, unchecking,
duplicate ids, unrelated-menu isolation, invalid indices, popup-row checks by
position and persistence into the next tracking blob. A seeded detached alias
tests resolver identity without pretending to load a PE resource. The new
dynamic-tree assertion failed before the runtime fix with return -1 rather
than 0 (`/private/tmp/wa-wvis-check-before.log`); passing main log is
`/private/tmp/wa-wvis-check-main.log`. Existing resource-position and nested
resource-mutation tests also pass in isolation.

Still open: the legacy attached-resource CheckMenuItem path scans unrelated
window blobs; GetMenuState lacks equivalent dynamic-tree support; mutating
an already-open tracking snapshot needs separate coverage. This change
specifically fixes canonical state setup before tracking, not those paths.

Isolated full build passes (`/private/tmp/wa-wvis-check-build.log`): wasm
1454818 bytes, compat 1455724, unchanged layout `c5ccefca8909ee4b`.
Rebuilt browser experiment with the workaround disabled exits 0 on the
existing visualization/submenu assertions (`/private/tmp/wa-wvis-check-browser.log`).
The menu probe now sees checked Slower Fade (40041) and Blur (40059), both
internal flag 4, and the screenshot visibly shows both check marks.

The extra select/reopen experiment is **not a command-selection pass**:
after hovering Rendering Options, clicking guest (350,257), waiting 1200 ms,
right-clicking (150,205), waiting 1200 ms and hovering (215,257) again, the
submenu flags are unchanged. Clear (40030) remains unchecked. The original
browser test does not assert that this extra action changed an option.
Next capture menu hover/close and queued WM_COMMAND immediately around that
click, then inspect the guest fade variable before claiming selection works.
The production renderer helper remains installed.

## Desktop forwarding stole submenu presses, 2026-09-21

The previous select/reopen result was not a missing WAT hit test. Its browser
`inputTrace` contains only handleMouseUp at (349,256), not handleMouseDown.
`forwardEmptyDesktopClick` in `lib/browser-input.js` runs before renderer
menu tracking and forwarded the press to an HTML desktop icon because that
point lies outside every guest window rectangle. A popup is an overlay and
can extend beyond its owner; app-window hit testing cannot establish that
the click belongs to the desktop.

The bridge now consults the renderer's live `_openMenuContext` before any
desktop DOM hit test. While a menu is open, selection and outside clicks both
go through menu tracking, including mouse and touch. It does not use the
plugin title, a guessed menu rectangle, or a second menu-state cache.

Validation: the actual DOM bridge test in `test-web-touch-input.js` covers a
secondary-owner popup over an HTML icon, mouse press/release, touch tap,
absence of desktop hit testing while open, and restored icon forwarding
after closure. Main and isolated tests pass. With the old bridge loaded,
the new mouse assertion fails (`[]` instead of the expected press), recorded
in `/private/tmp/wa-wvis-desktop-negative.log`. Relative-mouse lock-gate,
relative-mouse latch and Worker keyboard/menu tests also pass. No WAT or
import ABI changed in this slice.

The real wVis select/reopen run with the helper disabled exits 0 on its
existing assertions (`/private/tmp/wa-wvis-desktop-browser.log`). The trace
now includes both down and up at (349,256). Clear (40030) changes from flag 0
to flag 4 after reopening, demonstrating that the selection now affects the
menu state reconstructed by the guest. However, Slower Fade (40041) remains
checked too: **this is not a clean check-state round-trip**. The detached
LoadMenu cache and DestroyMenu lifetime are the next concrete suspects;
do not remove the production helper based solely on this partial success.
