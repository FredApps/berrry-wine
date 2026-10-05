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

## Detached destruction and fresh checks, 2026-09-21

Confirmed the stale-state cause: DestroyMenu on the tagged LoadMenu handle
fell through to host-map deletion. Its cached detached MNUD root remained
live, so the next open reused the already-checked tree. Dynamic destruction
also freed only the root and its labels, not descendant menus.

DestroyMenu now unlinks the existing detached alias (without lazily building
a new menu), destroys its canonical root and recursively retires owned MNUD
children. Destroying the canonical root directly also removes its alias.
The root's magic is retired before descent, with the allocation held until
children/labels are released, so a malformed self-link cannot recurse forever.
This implements the recursive destruction described by Microsoft's
[DestroyMenu documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-destroymenu).

Validation:

- `test-detached-menu-handle.js`: 24/24 on main and isolated sources. The
  tree is parsed from a real-format MENUITEMTEMPLATE; only alias-cache setup
  is synthetic. Coverage includes root/child/grandchild retirement, cache
  invalidation through both tagged and canonical handles, and a self-link.
  Old source fails six retirement/cache checks (18/24):
  `/private/tmp/wa-wvis-destroy-negative.log`.
- Main menu-insert (17/17), isolated nested-resource mutation, popup-text
  (13 checks) and DeleteMenu tests pass.
- `test-menu-item-info-wide.js` fails at line 149, before destruction, on
  both current main and the isolated copy. Restoring HEAD's pre-fix menu
  source on main produces the same string-release assertion failure:
  `/private/tmp/wa-wvis-wide-main-baseline.log`. It is not claimed as passing
  or fixed by this change.
- Isolated full build passes (`/private/tmp/wa-wvis-destroy-build.log`):
  1455021-byte wasm, 1455927-byte compat, layout `c5ccefca8909ee4b`.
- Rebuilt browser test, helper disabled, passes explicit Clear-after-reopen
  and Slower-Fade-cleared assertions in addition to the original test:
  `/private/tmp/wa-wvis-destroy-browser.log`. Before/after flags are
  Clear 0→4, Slower Fade 4→0, Blur 4→4; screenshot visually verified.

Still not complete native menu lifetime: TrackPopupMenu returns too early;
the tagged resource-handle scheme conflates simultaneous LoadMenu instances
and resource identity, and unmatched host DestroyMenu still reports success.
This fix retires an existing cached object instead of hiding destruction to
keep the asynchronous popup alive. The independently copied tracking blob
continues to paint; proper modal tracking remains open, as does removing the
production wVis helper.

## App-specific workaround removed, 2026-09-21

Removed `_openWorkerContextMenu` and its right-button-release interception
from `lib/renderer-input.js`: no window-title match, DLL-export-name scan,
hard-coded resource 101, manual allocator-global synchronization or synthetic
popup substitutes for the guest's WM_RBUTTONUP path. Its unreferenced WAT
export `menu_track_popup_open_module` is removed too (116 JS lines and 23
WAT lines). The compiled module has no such export and retains `menu_close`.

`test-winamp-visualization-web.js` now permanently performs the successful
browser sequence: open the guest menu, hover Rendering Options, snapshot
checks, select Clear with a real mouse click outside the owner rectangle,
reopen and snapshot checks again. It requires Clear to change from unchecked
to checked, all six other fade choices to be unchecked, and independent Blur
state to remain unchanged. Read-only eval snapshots use menu exports; the
actual actions use browser input. There is no helper-disabling monkey patch.
The obsolete comment claiming native modal behavior was removed.

Renderer multi-app ownership, Worker input and mouse/touch bridge tests pass
on main. Isolated compiled popup-text (13 checks) and active-window tests
pass. The permanent browser test passed after the JS helper removal:
`/private/tmp/wa-wvis-no-workaround-browser.log`. After deleting the unused
export, the isolated full build passes with wasm 1454887 bytes, compat
1455793 bytes and layout `c5ccefca8909ee4b`:
`/private/tmp/wa-wvis-remove-helper-build-repeat.log`. The initial export edit
accidentally removed the following function declaration as well; the fragment
gate caught it, `menu_close` was restored, and the repeat is the passing build.
The final permanent browser regression against that rebuilt artifact also
passes, terminal exit 0 (`/private/tmp/wa-wvis-no-workaround-final-browser.log`),
including the before/after check-state assertions. Final screenshot reviewed.

This removes the application-specific shortcut, not all generic menu gaps.
TrackPopupMenu's early return, unique LoadMenu identity, attached-resource
CheckMenuItem scope, dynamic GetMenuState and deeper cascade tracking remain
separate open work.

## Dynamic GetMenuState queries, 2026-09-21

GetMenuState now resolves a dynamic menu or detached cached alias to its
canonical record, rather than returning -1 merely because no window owns it.
By-position queries address exactly one level; by-command queries search the
tree and return the first match. Ordinary items return public MF flags (never
the private owned-text bit); popup positions pack child count in the high byte
and flags in the low byte. Missing items return UINT_MAX. Queries see subsequent
CheckMenuItem mutations without opening a popup or rebuilding a paint snapshot.
This follows [Microsoft's GetMenuState contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmenustate);
it is not a new native Win98 oracle measurement.

Validation: test-menu-popup-text.js passes all 14 checks on main and in the
rsync-updated isolated workspace. Its new public-handler regression checks
nested/duplicate IDs, exact positions, unrelated menus, owner-draw/separator
flags, popup counts, missing items, aliases and subsequent mutation. Substituting
HEAD's pre-fix menu source in memory makes that test fail at the first recursive
query (-1 instead of 8), without changing worktree files. Resource CheckMenuItem
and detached-menu lifetime tests also pass (the latter 24/24).

Attached-resource query behavior is unchanged. Unique LoadMenu identity,
resource CheckMenuItem scoping, modal tracking and deeper cascade support
remain open. No new browser run was needed for this read-only API change;
the preceding browser evidence belongs to the workaround-removal commit.

## Resource CheckMenuItem addressing, 2026-09-21

The attached-resource path no longer changes every window with a matching
command ID. It resolves the supplied menu, restricts dropdown handles to their
own subtree, and stops after the first command match. By-position updates the
exact row, including duplicate-ID rows, with explicit bounds checks; it no
longer converts a position into a whole-tree command search. ShowHideMenuCtl's
internal caller now supplies its menu handle as well. The contract is
[Microsoft CheckMenuItem](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-checkmenuitem),
not a new native Win98 trace.

The expanded test-menu-check-position.js exercises two separate attached
resource menus, duplicate IDs, sibling isolation, root searches and missing
positions/commands. With both pre-fix WAT fragments substituted in memory,
it fails because the duplicate row was also checked (4 instead of 0).
The first candidate also exposed an unchecked child_item_w index; explicit
position/count validation corrected it before commit.
Final resource-position and ShowHideMenuCtl tests pass on main and the
rsync-updated isolated tree; the dynamic popup suite passes all 14 checks
on main. These tests compile the current source through WATX. No new browser
run or full build-gate run was performed for this change.

Resource handles still encode identity using resource IDs: two separately
loaded menus sharing that ID remain ambiguous until LoadMenu identity is
replaced. This patch does not fix EnableMenuItem/CheckMenuRadioItem's separate
global scans, or stale canonical bindings after resource-blob mutations.
