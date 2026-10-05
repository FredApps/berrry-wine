#!/usr/bin/env node
// Standalone SysTreeView32 scroll regression. Loads the WAT module without a
// guest EXE, creates a native TreeView, inserts rows, then verifies that wheel,
// scrollbar arrows/page/thumb, TVGN_FIRSTVISIBLE, hit-test, and selection all
// use the same first-visible row.

'use strict';

const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
// $GUEST_BASE, from the map declared in src/00-regions.wat.
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const TVM_INSERTITEMA = 0x1100;
const TVM_DELETEITEM = 0x1101;
const TVM_EXPAND = 0x1102;
const TVM_GETCOUNT = 0x1105;
const TVM_GETNEXTITEM = 0x110A;
const TVM_SELECTITEM = 0x110B;
const TVM_GETITEMA = 0x110C;
const TVM_SETITEMA = 0x110D;
const TVM_HITTEST = 0x1111;
const TVM_ENSUREVISIBLE = 0x1114;
const TVGN_FIRSTVISIBLE = 5;
const TVGN_NEXTVISIBLE = 6;
const TVGN_DROPHILITE = 8;
const TVGN_CARET = 9;
const TVE_COLLAPSE = 1;
const TVE_EXPAND = 2;
const TVE_COLLAPSERESET = 0x8000;
const TVIS_SELECTED = 0x0002;
const TVIS_DROPHILITED = 0x0008;
const TVIS_EXPANDED = 0x0020;
const TVIS_EXPANDEDONCE = 0x0040;
const TVI_ROOT = 0xFFFF0000;
const TVN_SELCHANGINGA = -401;
const TVN_SELCHANGEDA = -402;
const TVN_ITEMEXPANDEDA = -406;
const WM_VSCROLL = 0x0115;
const WM_SETFOCUS = 0x0007;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_LBUTTONDBLCLK = 0x0203;
const WM_MOUSEMOVE = 0x0200;
const WM_MOUSEWHEEL = 0x020A;
const SB_THUMBTRACK = 5;

async function main() {
  const wasmBytes = compileSrcWasm();
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = {
    getMemory: () => memory.buffer,
    renderer: null,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const base = createHostImports(ctx);
  base.host.memory = memory;
  base.host.create_thread = () => 0;
  base.host.exit_thread = () => 0;
  base.host.terminate_thread = () => 0;
  base.host.create_event = () => 0;
  base.host.set_event = () => 0;
  base.host.reset_event = () => 0;
  base.host.wait_single = () => 0;
  base.host.wait_multiple = () => 0;
  base.host.com_create_instance = () => 0x80004002;

  const { instance } = await WebAssembly.instantiate(wasmBytes, base);
  ctx.exports = instance.exports;
  const e = instance.exports;
  const u8 = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);
  const wa = g => RegionMap.g2w(g, e.get_image_base());

  const checks = [];
  function check(name, pass, info = '') {
    checks.push({ name, pass });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (info ? '  (' + info + ')' : ''));
  }
  function writeStr(s) {
    const g = e.guest_alloc(s.length + 1);
    const p = wa(g);
    for (let i = 0; i < s.length; i++) u8[p + i] = s.charCodeAt(i);
    u8[p + s.length] = 0;
    return g;
  }
  function insertItem(text, parent = 0, state = null, childrenHint = 0, itemParam = 0,
    image = null, selectedImage = null) {
    const g = e.guest_alloc(56);
    const p = wa(g);
    u8.fill(0, p, p + 56);
    dv.setUint32(p + 0, parent, true);
    let mask = 0x0001; // TVIF_TEXT
    if (itemParam) mask |= 0x0004; // TVIF_PARAM
    if (state !== null) mask |= 0x0008; // TVIF_STATE
    if (image !== null) mask |= 0x0002; // TVIF_IMAGE
    if (selectedImage !== null) mask |= 0x0020; // TVIF_SELECTEDIMAGE
    if (childrenHint) mask |= 0x0040; // TVIF_CHILDREN
    dv.setUint32(p + 8, mask, true);
    if (state !== null) {
      dv.setUint32(p + 16, state, true);
      dv.setUint32(p + 20, 0x20, true); // TVIS_EXPANDED
    }
    dv.setUint32(p + 24, writeStr(text), true);
    if (image !== null) dv.setInt32(p + 32, image, true);
    if (selectedImage !== null) dv.setInt32(p + 36, selectedImage, true);
    dv.setUint32(p + 40, childrenHint, true);
    dv.setUint32(p + 44, itemParam, true);
    return e.send_message(tv, TVM_INSERTITEMA, 0, g) >>> 0;
  }
  function makeLParam(x, y) {
    return (x & 0xFFFF) | ((y & 0xFFFF) << 16);
  }
  function firstVisibleHandle() {
    return e.send_message(tv, TVM_GETNEXTITEM, TVGN_FIRSTVISIBLE, 0) >>> 0;
  }
  function getItemState(handle, stateMask = 0xFFFF) {
    const item = e.guest_alloc(40);
    const p = wa(item);
    u8.fill(0, p, p + 40);
    dv.setUint32(p + 0, 0x0008, true); // TVIF_STATE
    dv.setUint32(p + 4, handle, true);
    dv.setUint32(p + 12, stateMask, true);
    const ret = e.send_message(tv, TVM_GETITEMA, 0, item) | 0;
    return { ret, state: dv.getUint32(p + 8, true) };
  }
  function setItemState(handle, state, stateMask) {
    const item = e.guest_alloc(40);
    const p = wa(item);
    u8.fill(0, p, p + 40);
    dv.setUint32(p + 0, 0x0008, true); // TVIF_STATE
    dv.setUint32(p + 4, handle, true);
    dv.setUint32(p + 8, state, true);
    dv.setUint32(p + 12, stateMask, true);
    return e.send_message(tv, TVM_SETITEMA, 0, item) | 0;
  }
  function installSelectionNotifyParent() {
    const capture = e.guest_alloc(48) >>> 0;
    const veto = e.guest_alloc(4) >>> 0;
    const proc = e.guest_alloc(192) >>> 0;
    const code = [];
    const labels = new Map();
    const jumps = [];
    const emit = (...values) => code.push(...values.map(value => value & 0xFF));
    const le32 = value => [value, value >>> 8, value >>> 16, value >>> 24];
    const label = name => labels.set(name, code.length);
    const j32 = (condition, name) => {
      emit(0x0F, condition, 0, 0, 0, 0);
      jumps.push({ displacement: code.length - 4, name });
    };
    const storeEdx = address => emit(0x89, 0x15, ...le32(address));
    const increment = address => emit(0xFF, 0x05, ...le32(address));

    emit(0x8B, 0x44, 0x24, 0x08);                  // mov eax,[esp+8] (msg)
    emit(0x3D, 0x4E, 0x00, 0x00, 0x00);            // cmp eax,WM_NOTIFY
    j32(0x85, 'zero');                              // jne zero
    emit(0x8B, 0x44, 0x24, 0x10);                  // mov eax,[esp+16] (lParam)
    emit(0x85, 0xC0);                               // test eax,eax
    j32(0x84, 'zero');                              // jz zero
    emit(0x8B, 0x48, 0x08);                        // mov ecx,[eax+8] (code)
    emit(0x81, 0xF9, ...le32(TVN_SELCHANGINGA));    // cmp ecx,TVN_SELCHANGINGA
    j32(0x85, 'changed');                           // jne changed
    increment(capture);
    emit(0x8B, 0x50, 0x18); storeEdx(capture + 8);  // itemOld.state
    emit(0x8B, 0x50, 0x40); storeEdx(capture + 12); // itemNew.state
    emit(0x8B, 0x50, 0x14); storeEdx(capture + 24); // itemOld.hItem
    emit(0x8B, 0x50, 0x3C); storeEdx(capture + 28); // itemNew.hItem
    emit(0x8B, 0x50, 0x0C); storeEdx(capture + 40); // action
    emit(0xA1, ...le32(veto));                      // mov eax,[veto]
    emit(0xC2, 0x10, 0x00);                        // ret 16
    label('changed');
    emit(0x81, 0xF9, ...le32(TVN_SELCHANGEDA));     // cmp ecx,TVN_SELCHANGEDA
    j32(0x85, 'zero');                              // jne zero
    increment(capture + 4);
    emit(0x8B, 0x50, 0x18); storeEdx(capture + 16); // itemOld.state
    emit(0x8B, 0x50, 0x40); storeEdx(capture + 20); // itemNew.state
    emit(0x8B, 0x50, 0x14); storeEdx(capture + 32); // itemOld.hItem
    emit(0x8B, 0x50, 0x3C); storeEdx(capture + 36); // itemNew.hItem
    label('zero');
    emit(0x31, 0xC0, 0xC2, 0x10, 0x00);            // xor eax,eax; ret 16
    for (const jump of jumps) {
      const delta = labels.get(jump.name) - (jump.displacement + 4);
      code.splice(jump.displacement, 4, ...le32(delta));
    }
    u8.fill(0, wa(capture), wa(capture) + 48);
    u8.set(code, wa(proc));
    e.test_wnd_table_set(tv - 1, proc);
    return {
      clear() { u8.fill(0, wa(capture), wa(capture) + 48); },
      setVeto(value) { dv.setUint32(wa(veto), value, true); },
      get(offset) { return dv.getUint32(wa(capture) + offset, true); },
    };
  }

  const baselineSlots = e.wnd_count_used();
  const tv = e.test_create_treeview(0, 0, 160, 68, 0);
  check('treeview hwnd allocated', tv !== 0, 'hwnd=0x' + tv.toString(16));
  check('create added 2 slots (parent + treeview)', e.wnd_count_used() === baselineSlots + 2);

  const handles = [];
  for (let i = 0; i < 12; i++) {
    handles.push(insertItem(`Node ${i}`, 0, null, 0, 0,
      i === 0 ? 2 : null, i === 0 ? 3 : null));
  }
  check('TVM_INSERTITEMA returned handles', handles.every(Boolean));
  check('insertion does not create a caret before the control receives focus',
    e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) === 0);
  e.send_message(tv, WM_SETFOCUS, 0, 0);
  check('WM_SETFOCUS selects the first item when the TreeView has no caret',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === handles[0] &&
      (getItemState(handles[0]).state & TVIS_SELECTED) !== 0);
  const imageItem = e.guest_alloc(40);
  const imageItemP = wa(imageItem);
  u8.fill(0, imageItemP, imageItemP + 40);
  dv.setUint32(imageItemP, 0x0022, true); // TVIF_IMAGE | TVIF_SELECTEDIMAGE
  dv.setUint32(imageItemP + 4, handles[0], true);
  check('TVM_GETITEMA returns normal and selected image indexes',
    e.send_message(tv, TVM_GETITEMA, 0, imageItem) === 1 &&
      dv.getInt32(imageItemP + 24, true) === 2 &&
      dv.getInt32(imageItemP + 28, true) === 3);
  dv.setInt32(imageItemP + 24, 4, true);
  dv.setInt32(imageItemP + 28, 5, true);
  check('TVM_SETITEMA updates both image indexes',
    e.send_message(tv, TVM_SETITEMA, 0, imageItem) === 1);
  dv.setInt32(imageItemP + 24, -1, true);
  dv.setInt32(imageItemP + 28, -1, true);
  check('TreeView image indexes round-trip after TVM_SETITEMA',
    e.send_message(tv, TVM_GETITEMA, 0, imageItem) === 1 &&
      dv.getInt32(imageItemP + 24, true) === 4 &&
      dv.getInt32(imageItemP + 28, true) === 5);
  check('TVM_GETCOUNT is 12', e.send_message(tv, TVM_GETCOUNT, 0, 0) === 12);
  check('visible count is 12', e.treeview_get_visible_count() === 12);
  check('max scroll is 8 for 4-row viewport', e.treeview_get_max_scroll(tv) === 8);
  check('initial first visible is first item', firstVisibleHandle() === handles[0]);

  e.send_message(tv, WM_MOUSEWHEEL, (-120 << 16), 0);
  check('mouse wheel scrolls down 3 rows', e.treeview_get_first_visible_row() === 3);
  check('TVGN_FIRSTVISIBLE follows wheel scroll', firstVisibleHandle() === handles[3]);
  check('standard scrollbar state follows the TreeView viewport',
    e.standard_scroll_pos(tv, 1) === 3 &&
      e.standard_scroll_min(tv, 1) === 0 &&
      e.standard_scroll_max(tv, 1) === 11 &&
      e.standard_scroll_page(tv, 1) === 4);

  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(152, 60));
  e.send_message(tv, WM_LBUTTONUP, 0, makeLParam(152, 60));
  check('scrollbar down arrow advances one row', e.treeview_get_first_visible_row() === 4);

  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(152, 22));
  e.send_message(tv, WM_LBUTTONUP, 0, makeLParam(152, 22));
  check('scrollbar page-up region moves up by viewport rows', e.treeview_get_first_visible_row() === 0);

  e.send_message(tv, WM_VSCROLL, (6 << 16) | SB_THUMBTRACK, 0);
  check('WM_VSCROLL thumb track sets first visible row', e.treeview_get_first_visible_row() === 6);
  check('standard scrollbar position follows TreeView thumb track',
    e.standard_scroll_pos(tv, 1) === 6);

  const ht = e.guest_alloc(16);
  const htp = wa(ht);
  u8.fill(0, htp, htp + 16);
  dv.setInt32(htp + 0, 20, true);
  dv.setInt32(htp + 4, 4, true);
  check('TVM_HITTEST maps top row through scroll offset',
    (e.send_message(tv, TVM_HITTEST, 0, ht) >>> 0) === handles[6]);
  check('TVM_HITTEST writes scrolled hItem', dv.getUint32(htp + 12, true) === handles[6]);

  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(20, 20));
  check('click on visible row 1 selects underlying row 7',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === handles[7]);

  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(152, 43));
  e.send_message(tv, WM_MOUSEMOVE, 1, makeLParam(152, 61));
  e.send_message(tv, WM_LBUTTONUP, 0, makeLParam(152, 61));
  check('scrollbar thumb drag changes first visible row', e.treeview_get_first_visible_row() > 6);

  const parent = insertItem('Collapsed parent', 0, 0, 1, 0x12345678);
  const parentItem = e.guest_alloc(40);
  const parentItemP = wa(parentItem);
  u8.fill(0, parentItemP, parentItemP + 40);
  dv.setUint32(parentItemP, 0x0040, true); // TVIF_CHILDREN
  dv.setUint32(parentItemP + 4, parent, true);
  const getParentItem = e.send_message(tv, TVM_GETITEMA, 0, parentItem);
  const parentChildren = dv.getUint32(parentItemP + 32, true);
  check('TVIF_CHILDREN hint is preserved before lazy children are inserted',
    getParentItem === 1 && parentChildren === 1,
    `ret=${getParentItem} cChildren=${parentChildren}`);
  const textBuffer = e.guest_alloc(64);
  const textItem = e.guest_alloc(40);
  const textItemP = wa(textItem);
  u8.fill(0, textItemP, textItemP + 40);
  dv.setUint32(textItemP, 0x0001, true); // TVIF_TEXT
  dv.setUint32(textItemP + 4, parent, true);
  dv.setUint32(textItemP + 16, textBuffer, true);
  dv.setUint32(textItemP + 20, 64, true);
  check('TVM_GETITEMA copies item text into the caller buffer',
    e.send_message(tv, TVM_GETITEMA, 0, textItem) === 1 &&
      Buffer.from(u8.subarray(wa(textBuffer), wa(textBuffer) + 16))
        .toString('latin1').split('\0')[0] === 'Collapsed parent');
  const laterRoot = insertItem('Later root', 0, 0);
  const childA = insertItem('Child A', parent);
  const childB = insertItem('Child B', parent);
  // Three consecutive slot-encoded handles guarantee that at least one has
  // TVIS_SELECTED's bit clear. The regression below needs that shape to catch
  // code that accidentally ANDs a handle value with a state bit.
  const childC = insertItem('Child C', parent);
  check('collapsed parent hides all children', e.treeview_get_visible_count() === 14);
  check('TVGN_CHILD returns first hierarchical child',
    (e.send_message(tv, TVM_GETNEXTITEM, 4, parent) >>> 0) === childA);
  check('TVGN_PARENT returns hierarchical parent',
    (e.send_message(tv, TVM_GETNEXTITEM, 3, childB) >>> 0) === parent);
  const implicitParent = insertItem('Implicitly collapsed parent');
  const implicitChild = insertItem('Implicitly hidden child', implicitParent);
  check('an item inserted without TVIF_STATE remains collapsed after adding a child',
    (getItemState(implicitParent).state & TVIS_EXPANDED) === 0 &&
      e.send_message(tv, TVM_GETNEXTITEM, TVGN_NEXTVISIBLE, implicitParent) !== implicitChild);
  e.send_message(tv, TVM_DELETEITEM, 0, implicitParent);
  const beforeExpandNotify = e.treeview_get_debug_expand_notify_count();
  check('TVM_EXPAND reveals all children',
    e.send_message(tv, TVM_EXPAND, TVE_EXPAND, parent) === 1 &&
      e.treeview_get_visible_count() === 17);
  const selectedChild = [childA, childB, childC].find(handle => (handle & 0x0002) === 0);
  check('test has a selected child whose handle does not share TVIS_SELECTED bit',
    !!selectedChild,
    `childA=0x${childA.toString(16)} childB=0x${childB.toString(16)} childC=0x${childC.toString(16)}`);
  check('selected-descendant scan treats handle and state as booleans',
    !!selectedChild &&
      e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, selectedChild) === 1 &&
      e.treeview_has_selected_descendant(parent) === 1);
  e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, parent);
  check('TVGN_NEXTVISIBLE follows depth-first tree order, not allocation order',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_NEXTVISIBLE, parent) >>> 0) === childA &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_NEXTVISIBLE, childC) >>> 0) === laterRoot);
  check('TVM_EXPAND emits expanding/expanded notifications',
    e.treeview_get_debug_expand_notify_count() === beforeExpandNotify + 2 &&
      (e.treeview_get_debug_expand_notify_code() | 0) === TVN_ITEMEXPANDEDA &&
      e.treeview_get_debug_expand_notify_action() === TVE_EXPAND &&
      (e.treeview_get_debug_expand_notify_item() >>> 0) === parent &&
      e.treeview_get_debug_expand_notify_children() === 1);
  const beforeCollapseNotify = e.treeview_get_debug_expand_notify_count();
  check('TVM_EXPAND collapse hides all children again',
    e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, parent) === 1 &&
      e.treeview_get_visible_count() === 14);
  check('collapse after first expansion is quiet while EXPANDEDONCE remains set',
    e.treeview_get_debug_expand_notify_count() === beforeCollapseNotify);
  const leafExpandResult = e.send_message(tv, TVM_EXPAND, TVE_EXPAND, laterRoot) | 0;
  const leafCollapseResult = e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, laterRoot) | 0;
  const leafExpansionState = getItemState(laterRoot).state;
  check('expanding or collapsing a leaf fails without changing its state',
    leafExpandResult === 0 && leafCollapseResult === 0 &&
      (leafExpansionState & (TVIS_EXPANDED | TVIS_EXPANDEDONCE)) === 0,
    `expand=${leafExpandResult} collapse=${leafCollapseResult} state=0x${leafExpansionState.toString(16)}`);

  // Native Win98 keeps TVITEM state and the caret related but distinct.
  // TVM_SETITEM can set TVIS_SELECTED without moving the caret, and collapsing
  // that hidden item must not erase the independently assigned state bit.
  check('TVM_SETITEM TVIS_SELECTED does not move the caret',
    setItemState(childB, TVIS_SELECTED, TVIS_SELECTED) === 1 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      (getItemState(parent).state & TVIS_SELECTED) !== 0 &&
      (getItemState(childB).state & TVIS_SELECTED) !== 0);
  const beforeRepeatExpandNotify = e.treeview_get_debug_expand_notify_count();
  e.send_message(tv, TVM_EXPAND, TVE_EXPAND, parent);
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, parent);
  check('collapse preserves non-caret selected state on a hidden descendant',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      (getItemState(childB).state & TVIS_SELECTED) !== 0 &&
      e.treeview_get_debug_expand_notify_count() === beforeRepeatExpandNotify);
  setItemState(childB, 0, TVIS_SELECTED);

  // TVM_SELECTITEM has three Win98-era modes. Selecting a hidden caret reveals
  // its ancestors and minimally scrolls it into view; FIRSTVISIBLE reveals it
  // and places it at the top when the remaining content permits; DROPHILITE is
  // a separate, unique state that does not change the caret.
  check('TVGN_CARET reveals a hidden descendant and scrolls it into view',
    e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, childC) === 1 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === childC &&
      e.treeview_get_visible_count() === 17 &&
      e.treeview_get_first_visible_row() === 12 &&
      (getItemState(parent).state & (TVIS_EXPANDED | TVIS_EXPANDEDONCE)) ===
        (TVIS_EXPANDED | TVIS_EXPANDEDONCE));
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, parent);
  check('collapsing over the caret moves it quietly to the parent',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      (getItemState(parent).state & TVIS_SELECTED) !== 0 &&
      (getItemState(childC).state & TVIS_SELECTED) === 0);

  check('TVGN_FIRSTVISIBLE reveals without changing the caret',
    e.send_message(tv, TVM_SELECTITEM, TVGN_FIRSTVISIBLE, childA) === 1 &&
      firstVisibleHandle() === childA &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      (getItemState(parent).state & (TVIS_EXPANDED | TVIS_EXPANDEDONCE)) ===
        (TVIS_EXPANDED | TVIS_EXPANDEDONCE));
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, parent);
  check('TVM_ENSUREVISIBLE reveals and minimally scrolls a hidden item',
    e.send_message(tv, TVM_ENSUREVISIBLE, 0, childC) === 0 &&
      e.treeview_get_first_visible_row() === 12 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent);
  e.send_message(tv, WM_VSCROLL, 6, 0); // SB_TOP, ancestors remain expanded
  check('TVM_ENSUREVISIBLE returns nonzero for scrolling without expansion',
    e.send_message(tv, TVM_ENSUREVISIBLE, 0, childC) === 1 &&
      e.treeview_get_first_visible_row() === 12);

  check('TVGN_DROPHILITE marks a unique drag target without moving the caret',
    e.send_message(tv, TVM_SELECTITEM, TVGN_DROPHILITE, childB) === 1 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_DROPHILITE, 0) >>> 0) === childB &&
      (getItemState(childB).state & TVIS_DROPHILITED) !== 0 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      e.send_message(tv, TVM_SELECTITEM, TVGN_DROPHILITE, parent) === 1 &&
      (getItemState(childB).state & TVIS_DROPHILITED) === 0 &&
      (getItemState(parent).state & TVIS_DROPHILITED) !== 0);
  check('TVGN_DROPHILITE with NULL clears the drag target',
    e.send_message(tv, TVM_SELECTITEM, TVGN_DROPHILITE, 0) === 1 &&
      e.send_message(tv, TVM_GETNEXTITEM, TVGN_DROPHILITE, 0) === 0 &&
      (getItemState(parent).state & TVIS_DROPHILITED) === 0);
  check('TVM_SELECTITEM rejects an unknown mode',
    e.send_message(tv, TVM_SELECTITEM, 0x7FFF, parent) === 0);

  // A real x86 parent wndproc observes the pre/post state carried by Win98's
  // two selection notifications and can veto during TVN_SELCHANGINGA.
  const notifyParent = installSelectionNotifyParent();
  notifyParent.setVeto(1);
  notifyParent.clear();
  const vetoResult = e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, childB) | 0;
  const vetoObserved = Array.from({ length: 11 }, (_, index) => notifyParent.get(index * 4));
  check('TVN_SELCHANGINGA veto rejects a caret change before mutation',
    vetoResult === 0 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === parent &&
      (getItemState(parent).state & TVIS_SELECTED) === TVIS_SELECTED &&
      (getItemState(childB).state & TVIS_SELECTED) === 0 &&
      notifyParent.get(0) === 1 && notifyParent.get(4) === 0 &&
      (notifyParent.get(8) & TVIS_SELECTED) === TVIS_SELECTED &&
      (notifyParent.get(12) & TVIS_SELECTED) === 0 &&
      notifyParent.get(24) === parent && notifyParent.get(28) === childB &&
      notifyParent.get(40) === 0,
    `ret=${vetoResult} capture=${vetoObserved.map(value => `0x${value.toString(16)}`).join(',')}`);
  notifyParent.setVeto(0);
  notifyParent.clear();
  const acceptResult = e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, childB) | 0;
  const acceptObserved = Array.from({ length: 11 }, (_, index) => notifyParent.get(index * 4));
  check('accepted caret change notifies before and after Win98 state transition',
    acceptResult === 1 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === childB &&
      notifyParent.get(0) === 1 && notifyParent.get(4) === 1 &&
      (notifyParent.get(8) & TVIS_SELECTED) === TVIS_SELECTED &&
      (notifyParent.get(12) & TVIS_SELECTED) === 0 &&
      (notifyParent.get(16) & TVIS_SELECTED) === 0 &&
      (notifyParent.get(20) & TVIS_SELECTED) === TVIS_SELECTED &&
      notifyParent.get(24) === parent && notifyParent.get(28) === childB &&
      notifyParent.get(32) === parent && notifyParent.get(36) === childB,
    `ret=${acceptResult} capture=${acceptObserved.map(value => `0x${value.toString(16)}`).join(',')}`);
  notifyParent.clear();
  check('selecting the current caret succeeds without redundant notifications',
    e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, childB) === 1 &&
      notifyParent.get(0) === 0 && notifyParent.get(4) === 0);

  // RegEdit depends on standard TreeView mouse semantics: merely crossing a
  // plus box must not expand it or move the caret. Expansion belongs to an
  // explicit plus-box click or a row double-click.
  const hoverChild = insertItem('Hover child', handles[0]);
  e.send_message(tv, WM_VSCROLL, 6, 0); // SB_TOP: make Node 0 the top row
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, handles[0]);
  const hoverCollapsedCount = e.treeview_get_visible_count();
  const caretBeforeHover = e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0;
  e.send_message(tv, WM_MOUSEMOVE, 0, makeLParam(8, 4));
  check('plain hover over a plus box does not expand or select its item',
    e.treeview_get_visible_count() === hoverCollapsedCount &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === caretBeforeHover);

  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, handles[0]);
  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(32, 4));
  check('single click on row text selects without expanding',
    (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === handles[0] &&
      e.treeview_get_visible_count() === hoverCollapsedCount);
  e.send_message(tv, WM_LBUTTONDOWN, 1, makeLParam(8, 4));
  check('single click on the plus box expands the item',
    e.treeview_get_visible_count() === hoverCollapsedCount + 1 && hoverChild !== 0);
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, handles[0]);
  e.send_message(tv, WM_LBUTTONDBLCLK, 1, makeLParam(32, 4));
  check('double-click on row text expands the item',
    e.treeview_get_visible_count() === hoverCollapsedCount + 1);

  // TVE_COLLAPSERESET is a destructive collapse used by lazy trees: it
  // removes descendants child-first and clears EXPANDEDONCE so a later
  // expansion can notify/populate again.
  const resetRoot = insertItem('Reset root');
  const resetChild = insertItem('Reset child', resetRoot);
  const resetGrandchild = insertItem('Reset grandchild', resetChild);
  check('reset fixture expands and selects a descendant',
    e.send_message(tv, TVM_EXPAND, TVE_EXPAND, resetRoot) === 1 &&
      e.send_message(tv, TVM_EXPAND, TVE_EXPAND, resetChild) === 1 &&
      e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, resetGrandchild) === 1);
  const beforeExpandedReset = e.send_message(tv, TVM_GETCOUNT, 0, 0);
  check('TVE_COLLAPSERESET removes descendants and resets expansion state',
    e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE | TVE_COLLAPSERESET, resetRoot) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === beforeExpandedReset - 2 &&
      e.send_message(tv, TVM_GETNEXTITEM, 4, resetRoot) === 0 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === resetRoot &&
      (getItemState(resetRoot).state & (TVIS_EXPANDED | TVIS_EXPANDEDONCE)) === 0 &&
      getItemState(resetChild).ret === 0 && getItemState(resetGrandchild).ret === 0);
  const collapsedResetRoot = insertItem('Already collapsed reset root');
  const collapsedResetChild = insertItem('Already collapsed reset child', collapsedResetRoot);
  e.send_message(tv, TVM_EXPAND, TVE_EXPAND, collapsedResetRoot);
  e.send_message(tv, TVM_EXPAND, TVE_COLLAPSE, collapsedResetRoot);
  const beforeCollapsedReset = e.send_message(tv, TVM_GETCOUNT, 0, 0);
  check('COLLAPSERESET on an already-collapsed branch returns FALSE but still resets',
    e.send_message(tv, TVM_EXPAND,
      TVE_COLLAPSE | TVE_COLLAPSERESET, collapsedResetRoot) === 0 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === beforeCollapsedReset - 1 &&
      e.send_message(tv, TVM_GETNEXTITEM, 4, collapsedResetRoot) === 0 &&
      (getItemState(collapsedResetRoot).state & TVIS_EXPANDEDONCE) === 0 &&
      getItemState(collapsedResetChild).ret === 0);

  // Native TVM_DELETEITEM removes a whole branch in post-order, unlinks the
  // surviving siblings, invalidates every removed handle and moves a caret
  // inside that branch to the next sibling when one exists.
  const deleteGrandchild = insertItem('Delete grandchild', childA);
  const beforeBranchDelete = e.send_message(tv, TVM_GETCOUNT, 0, 0);
  e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, deleteGrandchild);
  check('TVM_DELETEITEM recursively removes a selected branch',
    e.send_message(tv, TVM_DELETEITEM, 0, childA) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === beforeBranchDelete - 2 &&
      (e.send_message(tv, TVM_GETNEXTITEM, 4, parent) >>> 0) === childB &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === childB &&
      getItemState(childA).ret === 0 &&
      getItemState(deleteGrandchild).ret === 0);
  check('TVM_DELETEITEM rejects an invalidated handle',
    e.send_message(tv, TVM_DELETEITEM, 0, childA) === 0);
  const beforeSelectedLeafDelete = e.send_message(tv, TVM_GETCOUNT, 0, 0);
  notifyParent.setVeto(1);
  notifyParent.clear();
  check('selection veto does not cancel deletion and leaves no stale caret',
    e.send_message(tv, TVM_DELETEITEM, 0, childB) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === beforeSelectedLeafDelete - 1 &&
      (e.send_message(tv, TVM_GETNEXTITEM, 4, parent) >>> 0) === childC &&
      e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) === 0 &&
      notifyParent.get(0) === 1 && notifyParent.get(4) === 0);
  notifyParent.setVeto(0);
  e.send_message(tv, TVM_SELECTITEM, TVGN_CARET, childC);
  const beforeParentDelete = e.send_message(tv, TVM_GETCOUNT, 0, 0);
  check('deleting a parent removes its remaining descendants and selects next root',
    e.send_message(tv, TVM_DELETEITEM, 0, parent) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === beforeParentDelete - 2 &&
      (e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) >>> 0) === laterRoot &&
      getItemState(parent).ret === 0 &&
      getItemState(childC).ret === 0);

  check('TVI_ROOT deletes every item and resets the viewport',
    e.send_message(tv, TVM_DELETEITEM, 0, TVI_ROOT) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === 0 &&
      e.send_message(tv, TVM_GETNEXTITEM, 0, 0) === 0 &&
      e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) === 0 &&
      e.treeview_get_visible_count() === 0 &&
      e.treeview_get_first_visible_row() === 0);
  const reinsertedRoot = insertItem('Reinserted root');
  const reinsertedChild = insertItem('Reinserted child', reinsertedRoot);
  check('TreeView slots and links remain reusable after delete-all',
    reinsertedRoot !== 0 && reinsertedChild !== 0 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === 2 &&
      (e.send_message(tv, TVM_GETNEXTITEM, 0, 0) >>> 0) === reinsertedRoot);
  check('NULL lParam is the second documented delete-all form',
    e.send_message(tv, TVM_DELETEITEM, 0, 0) === 1 &&
      e.send_message(tv, TVM_GETCOUNT, 0, 0) === 0 &&
      e.send_message(tv, TVM_GETNEXTITEM, TVGN_CARET, 0) === 0);

  if (e.wnd_destroy_tree) e.wnd_destroy_tree(tv - 1);
  check('slot count returns to baseline after destroy', e.wnd_count_used() === baselineSlots);

  console.log('');
  const failed = checks.filter(c => !c.pass).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
