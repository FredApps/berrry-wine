#!/usr/bin/env node
// LBS_SORT: LB_ADDSTRING keeps a string listbox in lstrcmpi order, while
// LB_INSERTSTRING still puts a row exactly where it is told.
//
// The case that matters is DlgDirList(DDL_DRIVES) into a sorted listbox:
// "[-x-]" drive rows sort above every file name. Civilization II finds its CD
// by walking that list, copying each row into a 6-byte stack buffer and
// stopping at the drive it wants; with the drives appended after the files, a
// 12-character name such as council0.fre ran over the buffer's saved DS and
// the game later trapped opening the Defense Minister (F2).
//
// PASS criteria:
//   - sorted adds come back in lstrcmpi order, drives before files,
//     case-insensitively, with LB_ADDSTRING returning the row it landed on
//   - equal strings keep insertion order (a new row goes after its equals)
//   - LB_INSERTSTRING at an explicit index, and at -1, does not re-sort
//   - a selection below a sorted insert moves down with its row
//   - a listbox without LBS_SORT still appends

const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');
const RegionMap = require('../lib/region-map.generated.js');

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

  const checks = [];
  function check(name, pass, info = '') {
    checks.push({ name, pass });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (info ? '  (' + info + ')' : ''));
  }
  const writeStr = (s) => {
    const g = e.guest_alloc(s.length + 1);
    const wa = RegionMap.g2w(g, e.get_image_base());
    const u8 = new Uint8Array(memory.buffer);
    for (let i = 0; i < s.length; i++) u8[wa + i] = s.charCodeAt(i);
    u8[wa + s.length] = 0;
    return g;
  };
  const readStr = (g) => {
    const u8 = new Uint8Array(memory.buffer);
    const wa = RegionMap.g2w(g, e.get_image_base());
    let s = '';
    for (let i = 0; i < 256 && u8[wa + i]; i++) s += String.fromCharCode(u8[wa + i]);
    return s;
  };
  const LB_ADDSTRING = 0x0180, LB_INSERTSTRING = 0x0181, LB_GETTEXT = 0x0189;
  const LB_GETCOUNT = 0x018B, LB_SETCURSEL = 0x0186, LB_GETCURSEL = 0x0188;
  const LB_SETITEMDATA = 0x019A, LB_GETITEMDATA = 0x0199;
  const rows = (lb) => {
    const out = [];
    const n = e.send_message(lb, LB_GETCOUNT, 0, 0);
    const buf = e.guest_alloc(256);
    for (let i = 0; i < n; i++) {
      e.send_message(lb, LB_GETTEXT, i, buf);
      out.push(readStr(buf));
    }
    return out;
  };

  // The listbox Civilization II creates for its CD probe: WS_CHILD | WS_BORDER
  // | WS_VSCROLL | LBS_NOTIFY | LBS_SORT, filled the way DlgDirList fills it
  // (files first, then drives).
  const sorted = e.test_create_listbox(0, 0, 200, 100);
  e.wnd_set_style_export(sorted, 0x40a00003);
  const adds = ['civ2.exe', 'council0.fre', 'Advice.txt', 'camp10.sav',
                '[-a-]', '[-c-]', '[-d-]'];
  const landed = adds.map(s => e.send_message(sorted, LB_ADDSTRING, 0, writeStr(s)));
  const expect = ['[-a-]', '[-c-]', '[-d-]', 'Advice.txt', 'camp10.sav', 'civ2.exe', 'council0.fre'];
  const got = rows(sorted);
  check('LBS_SORT rows come back in lstrcmpi order, drives first',
    JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got));
  check('LB_ADDSTRING returns the row each string landed on',
    JSON.stringify(landed) === JSON.stringify([0, 1, 0, 1, 0, 1, 2]), JSON.stringify(landed));

  // The CD probe's walk: every row up to and including the drive it wants
  // fits the 6-byte buffer.
  const probe = got.slice(0, got.indexOf('[-d-]') + 1);
  check('every row before the CD drive fits a 6-byte buffer',
    probe.length === 3 && probe.every(s => s.length + 1 <= 6), JSON.stringify(probe));

  // Item data travels with its row through a sorted insert.
  e.send_message(sorted, LB_SETITEMDATA, 3, 0x1234);    // Advice.txt
  e.send_message(sorted, LB_SETCURSEL, 5, 0);            // civ2.exe
  const at = e.send_message(sorted, LB_ADDSTRING, 0, writeStr('ADVICE.TXT'));
  check('an equal string goes after its equals', at === 4 && rows(sorted)[4] === 'ADVICE.TXT',
    `at=${at}`);
  check('item data stays with its row', e.send_message(sorted, LB_GETITEMDATA, 3, 0) === 0x1234 &&
    e.send_message(sorted, LB_GETITEMDATA, 4, 0) === 0);
  check('the selection moves down with its row',
    e.send_message(sorted, LB_GETCURSEL, 0, 0) === 6 && rows(sorted)[6] === 'civ2.exe');

  // LB_INSERTSTRING never sorts, even in an LBS_SORT listbox.
  const ins = e.send_message(sorted, LB_INSERTSTRING, 1, writeStr('zzz'));
  const tail = e.send_message(sorted, LB_INSERTSTRING, -1, writeStr('aaa'));
  const after = rows(sorted);
  check('LB_INSERTSTRING at an index does not re-sort', ins === 1 && after[1] === 'zzz',
    JSON.stringify(after));
  check('LB_INSERTSTRING at -1 appends unsorted',
    tail === after.length - 1 && after[after.length - 1] === 'aaa');

  // Without LBS_SORT nothing moves.
  const plain = e.test_create_listbox(0, 0, 200, 100);
  for (const s of ['civ2.exe', '[-a-]', 'Advice.txt']) {
    e.send_message(plain, LB_ADDSTRING, 0, writeStr(s));
  }
  check('a listbox without LBS_SORT appends',
    JSON.stringify(rows(plain)) === JSON.stringify(['civ2.exe', '[-a-]', 'Advice.txt']));

  console.log('');
  const failed = checks.filter(c => !c.pass).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
