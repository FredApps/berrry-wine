#!/usr/bin/env node
'use strict';
// The Win16 entry points the Over1000Games shareware corpus stopped on:
// USER.268-271 (the global atom table), USER.473 AnsiPrev, USER.233 SetParent
// and the TOOLHELP subset a Borland/MSC startup installs its fault handler
// through. Each is checked for the behaviour the app actually depends on, not
// merely for not trapping -- an atom that does not round-trip, an AnsiPrev
// that walks off the front of a string, or an InterruptRegister that claims
// success it cannot deliver are all worse than the crash they replaced.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func $test_stack (param $sp i32)
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (call $win16_sel_to_index (global.get $WIN16_THUNK_SEL))
      (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (global.set $code16 (i32.const 1))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (i32.store offset=16 (global.get $reg_base) (local.get $sp))
    (call $gs16 (local.get $sp) (i32.const 77))
    (call $gs16 (i32.add (local.get $sp) (i32.const 2)) (call $win16_index_to_sel (i32.const 1))))

  ;; The data selector's guest addresses are its base plus the offset, so a
  ;; test writes and reads at 0x110000+off and passes (sel2, off) as the far
  ;; pointer the API sees.
  (func (export "test_data_sel") (result i32) (call $win16_index_to_sel (i32.const 2)))
  (func (export "test_poke") (param $off i32) (param $byte i32)
    (call $gs8 (i32.add (i32.const 0x110000) (local.get $off)) (local.get $byte)))
  (func (export "test_peek") (param $off i32) (result i32)
    (call $gl8 (i32.add (i32.const 0x110000) (local.get $off))))
  (func (export "test_peek32") (param $off i32) (result i32)
    (call $gl32 (i32.add (i32.const 0x110000) (local.get $off))))
  (func (export "test_poke32") (param $off i32) (param $v i32)
    (call $gs32 (i32.add (i32.const 0x110000) (local.get $off)) (local.get $v)))
  (func (export "test_esp") (result i32) (i32.load offset=16 (global.get $reg_base)))
  (func (export "test_dx") (result i32) (i32.load offset=8 (global.get $reg_base)))

  ;; USER.268 GlobalAddAtom / .270 GlobalFindAtom -- one far string.
  (func (export "test_atom_str") (param $which i32) (param $sel i32) (param $off i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (local.get $off))
    (call $gs16 (i32.const 0x110F06) (local.get $sel))
    (call $win16_global_atom (local.get $which))
    (i32.load (global.get $reg_base)))
  ;; USER.269 GlobalDeleteAtom -- one atom.
  (func (export "test_atom_delete") (param $atom i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (local.get $atom))
    (call $win16_global_atom (i32.const 2))
    (i32.load (global.get $reg_base)))
  ;; USER.271 GlobalGetAtomName(nAtom, lpBuffer, nSize).
  (func (export "test_atom_name") (param $atom i32) (param $sel i32) (param $off i32)
        (param $size i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (local.get $size))
    (call $gs16 (i32.const 0x110F06) (local.get $off))
    (call $gs16 (i32.const 0x110F08) (local.get $sel))
    (call $gs16 (i32.const 0x110F0A) (local.get $atom))
    (call $win16_global_atom (i32.const 3))
    (i32.load (global.get $reg_base)))
  ;; The same table a Win32 caller reaches, to prove there is only one.
  (func (export "test_atom_find32") (param $off i32) (result i32)
    (call $handle_GlobalFindAtomA (i32.add (i32.const 0x110000) (local.get $off))
      (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load (global.get $reg_base)))

  ;; USER.473 AnsiPrev(lpszStart, lpszCurrentChar).
  (func (export "test_ansi_prev") (param $sel i32) (param $start i32) (param $cur i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (local.get $cur))
    (call $gs16 (i32.const 0x110F06) (local.get $sel))
    (call $gs16 (i32.const 0x110F08) (local.get $start))
    (call $gs16 (i32.const 0x110F0A) (local.get $sel))
    (call $win16_AnsiPrev)
    (i32.load (global.get $reg_base)))

  ;; USER.233 SetParent(hWndChild, hWndNewParent).
  (func (export "test_set_parent") (param $child i32) (param $parent i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (call $win16_h16 (local.get $parent)))
    (call $gs16 (i32.const 0x110F06) (call $win16_h16 (local.get $child)))
    (call $win16_SetParent)
    (call $win16_h32 (i32.load (global.get $reg_base))))
  (func (export "test_make_window") (param $style i32) (result i32)
    (local $h i32)
    (local.set $h (global.get $next_hwnd))
    (global.set $next_hwnd (i32.add (global.get $next_hwnd) (i32.const 1)))
    (call $wnd_table_set (local.get $h) (global.get $WNDPROC_CTRL_NATIVE))
    (drop (call $wnd_set_style (local.get $h) (local.get $style)))
    (local.get $h))
  (func (export "test_parent_of") (param $h i32) (result i32) (call $wnd_get_parent (local.get $h)))

  ;; TOOLHELP.75 InterruptRegister(hTask, lpfnCallback) and .76 InterruptUnRegister(hTask).
  (func (export "test_interrupt_register") (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (i32.const 0x1234))
    (call $gs16 (i32.const 0x110F06) (call $win16_index_to_sel (i32.const 1)))
    (call $gs16 (i32.const 0x110F08) (i32.const 0x55))
    (call $win16_InterruptRegister)
    (i32.load (global.get $reg_base)))
  (func (export "test_interrupt_unregister") (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (i32.const 0x55))
    (call $win16_InterruptUnRegister)
    (i32.load (global.get $reg_base)))

  ;; TOOLHELP.54 GlobalEntryHandle(lpGlobal, hItem).
  (func (export "test_global_entry") (param $item i32) (param $sel i32) (param $off i32) (result i32)
    (call $test_stack (i32.const 0x110F00))
    (call $gs16 (i32.const 0x110F04) (local.get $item))
    (call $gs16 (i32.const 0x110F06) (local.get $off))
    (call $gs16 (i32.const 0x110F08) (local.get $sel))
    (call $win16_GlobalEntryHandle)
    (i32.load (global.get $reg_base)))
  (func (export "test_seg2_sel") (result i32) (call $win16_index_to_sel (i32.const 2)))
`;

const writeStr = (e, off, text) => {
  for (let i = 0; i < text.length; i++) e.test_poke(off + i, text.charCodeAt(i));
  e.test_poke(off + text.length, 0);
};
const readStr = (e, off) => {
  let s = '';
  for (let i = 0; i < 64; i++) {
    const c = e.test_peek(off + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
};

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const sel = e.test_data_sel();
  const SP = 0x110F00;

  // --- USER.268/270/271/269: the global atom table round-trips, and it is
  // the same table a Win32 caller reaches.
  writeStr(e, 0x200, 'commdlg_FindReplace');
  assert.strictEqual(e.test_atom_str(1, sel, 0x200), 0,
    'GlobalFindAtom must answer 0 for a name never added');
  const atom = e.test_atom_str(0, sel, 0x200);
  assert.ok(atom >= 0xC000 && atom <= 0xFFFF, `GlobalAddAtom returned ${atom}`);
  assert.strictEqual(e.test_dx(), 0, 'a WORD result must not leave garbage in DX');
  assert.strictEqual(e.test_esp(), SP + 8,
    'GlobalAddAtom pops its far pointer and the far return');
  assert.strictEqual(e.test_atom_str(1, sel, 0x200), atom,
    'GlobalFindAtom must find the atom GlobalAddAtom just made');
  assert.strictEqual(e.test_atom_find32(0x200), atom,
    'a Win32 GlobalFindAtomA must see the same atom -- one table, not two');

  writeStr(e, 0x300, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const n = e.test_atom_name(atom, sel, 0x300, 32);
  assert.strictEqual(n, 'commdlg_FindReplace'.length, `GlobalGetAtomName returned ${n}`);
  assert.strictEqual(readStr(e, 0x300), 'commdlg_FindReplace');
  assert.strictEqual(e.test_esp(), SP + 12, 'GlobalGetAtomName pops 8 bytes of arguments');

  // GlobalDeleteAtom answers 0 on success, and the name is gone afterwards.
  assert.strictEqual(e.test_atom_delete(atom), 0, 'GlobalDeleteAtom succeeds with 0');
  assert.strictEqual(e.test_atom_str(1, sel, 0x200), 0,
    'a deleted atom must no longer be findable');

  // --- USER.473 AnsiPrev steps back one byte, and stands still at lpszStart
  // so a backwards walk terminates instead of running off the front. CTL3DV2
  // walks its own module path this way to find the last backslash.
  writeStr(e, 0x400, 'C:\\WINDOWS\\SYSTEM\\CTL3DV2.DLL');
  assert.strictEqual(e.test_ansi_prev(sel, 0x400, 0x410), 0x40F,
    'AnsiPrev must step back one character');
  assert.strictEqual(e.test_esp(), SP + 12, 'AnsiPrev pops two far pointers');
  assert.strictEqual(e.test_ansi_prev(sel, 0x400, 0x400), 0x400,
    'AnsiPrev at lpszStart must stand still, not walk off the front');

  // --- USER.233 SetParent reparents and answers with the previous parent.
  const oldParent = e.test_make_window(0x90000000);
  const newParent = e.test_make_window(0x90000000);
  const child = e.test_make_window(0x50000000);
  e.test_set_parent(child, oldParent);
  const previous = e.test_set_parent(child, newParent);
  assert.strictEqual(previous, oldParent,
    'SetParent must return the parent the child had before the call');
  assert.strictEqual(e.test_parent_of(child), newParent,
    'SetParent must actually reparent the child');
  assert.strictEqual(e.test_esp(), SP + 8, 'SetParent pops two words');

  // --- TOOLHELP.75/76. This machine raises no processor faults into a guest,
  // so there is nothing to register against and the SDK's documented failure
  // is the truthful answer. A caller that ignores it is no worse off; one that
  // checks it is told the truth rather than handed a handler that never fires.
  assert.strictEqual(e.test_interrupt_register(), 0,
    'InterruptRegister must report failure, never a callback it cannot deliver');
  assert.strictEqual(e.test_esp(), SP + 10, 'InterruptRegister pops 6 bytes');
  assert.strictEqual(e.test_interrupt_unregister(), 0,
    'InterruptUnRegister must report that nothing was registered');
  assert.strictEqual(e.test_esp(), SP + 6, 'InterruptUnRegister pops 2 bytes');

  // --- TOOLHELP.54 GlobalEntryHandle fills the fields a selector really has.
  // dwSize is the caller's, as the SDK requires; a structure too small is
  // refused rather than partly written.
  e.test_poke32(0x500, 36);
  const ok = e.test_global_entry(e.test_seg2_sel(), sel, 0x500);
  assert.strictEqual(ok, 1, 'GlobalEntryHandle must succeed for a live selector');
  assert.strictEqual(e.test_peek32(0x504), 0x110000,
    'dwAddress must be the selector base');
  assert.strictEqual(e.test_peek32(0x508), 0x10000,
    'dwBlockSize must be the selector size in bytes');
  assert.strictEqual(e.test_esp(), SP + 10, 'GlobalEntryHandle pops 6 bytes');

  e.test_poke32(0x600, 8);   // too small for a GLOBALENTRY
  assert.strictEqual(e.test_global_entry(e.test_seg2_sel(), sel, 0x600), 0,
    'a dwSize smaller than GLOBALENTRY must be refused');
  assert.strictEqual(e.test_global_entry(0x4321, sel, 0x500), 0,
    'a handle that names no segment must be refused');

  console.log('PASS test-win16-atoms-toolhelp');
})().catch(err => { console.error(err); process.exit(1); });
