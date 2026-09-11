#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const STACK = 0x074ff000, PATH = 0x00480000, MACRO = PATH + 0x1000;
const CODE = PATH + 0x2000, BUFFER = PATH + 0x3000, COUNT = PATH + 0x6000;
const STATE = PATH + 0x6100, THUNK = 0x07500000;
const READ = THUNK + 16, SLEEP = THUNK + 24;
const id = name => apis.find(api => api.name === name).id;
const extraWat = String.raw`
 (func (export "macro_setup") (param $a i32) (param $w i32) (param $read i32) (param $sleep i32)
   (global.set $thunk_guest_base (i32.const 0x07500000))
   (global.set $thunk_guest_end (i32.const 0x07500028))
   (global.set $num_thunks (i32.const 5))
   (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=4 (global.get $THUNK_BASE) (local.get $a))
   (i32.store offset=8 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=12 (global.get $THUNK_BASE) (local.get $w))
   (i32.store offset=16 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=20 (global.get $THUNK_BASE) (local.get $read))
   (i32.store offset=24 (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=28 (global.get $THUNK_BASE) (local.get $sleep))
   (i32.store offset=32 (global.get $THUNK_BASE) (i32.const 0xCACA0011))
   (i32.store offset=36 (global.get $THUNK_BASE) (i32.const 0))
   (global.set $font_enum_ret_thunk (i32.const 0x07500020))
   (call $clear_cache))
 (func (export "macro_begin") (param $wide i32)
   (global.set $esp (i32.const 0x074ff000))
   (global.set $eip (i32.add (i32.const 0x07500000) (i32.shl (local.get $wide) (i32.const 3))))
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
 (func (export "macro_epoch") (result i32) (global.get $help_document_epoch))
 (func (export "macro_jobs") (result i32) (global.get $help_macro_api_jobs))
 (func (export "macro_context") (result i32) (global.get $help_macro_api_context))
 (func (export "macro_resolvers") (result i32) (global.get $help_routine_pending))
`;

// Replace only the fixed-size |SYSTEM payload; all original directory/topic
// offsets remain valid. The fixture really registers Probe during HLP parsing.
function helpFixture(dllName) {
  const b = Buffer.from(fs.readFileSync(path.join(__dirname, 'binaries/help/freecell.hlp')));
  const internal = 1211, size = b.readUInt32LE(internal + 4), start = internal + 9;
  assert.strictEqual(b.readUInt16LE(start), 0x036c);
  let pos = start + 12;
  function record(type, bytes) {
    b.writeUInt16LE(type, pos); b.writeUInt16LE(bytes.length, pos + 2);
    bytes.copy(b, pos + 4); pos += 4 + bytes.length;
  }
  b.fill(0, pos, start + size);
  record(1, Buffer.from('Macro fixture\0'));
  record(3, Buffer.alloc(4));
  record(4, Buffer.from(`RegisterRoutine("${dllName}","Probe","SI")\0`));
  // Unknown tagged padding remains structurally valid, unlike raw zero tails.
  record(0x7ffe, Buffer.alloc(start + size - pos - 4));
  assert.strictEqual(pos, start + size);
  return b;
}

// A real PE32 DLL export, not a mocked resolver. Its position-independent
// trampoline jumps to the synthetic x86 callback in the test process.
function dllFixture(name, target = CODE) {
  assert(Buffer.byteLength(name) < 16, 'DLL name must fit before the export-name slot');
  const b = Buffer.alloc(0x2400), pe = 0x80, opt = pe + 24, sec = opt + 0xe0;
  b.writeUInt16LE(0x5a4d); b.writeUInt32LE(pe, 0x3c);
  b.writeUInt32LE(0x4550, pe); b.writeUInt16LE(0x14c, pe + 4);
  b.writeUInt16LE(1, pe + 6); b.writeUInt16LE(0xe0, pe + 20); b.writeUInt16LE(0x210e, pe + 22);
  b.writeUInt16LE(0x10b, opt); b.writeUInt32LE(0x400, opt + 4);
  b.writeUInt32LE(0x1000, opt + 16); b.writeUInt32LE(0x1000, opt + 20);
  b.writeUInt32LE(0x10000000, opt + 28); b.writeUInt32LE(0x1000, opt + 32);
  b.writeUInt32LE(0x200, opt + 36); b.writeUInt32LE(0x2000, opt + 56);
  b.writeUInt32LE(0x200, opt + 60); b.writeUInt16LE(2, opt + 68); b.writeUInt32LE(16, opt + 92);
  b.writeUInt32LE(0x1100, opt + 96); b.writeUInt32LE(0x80, opt + 100);
  b.write('.text\0\0\0', sec); b.writeUInt32LE(0x400, sec + 8); b.writeUInt32LE(0x1000, sec + 12);
  b.writeUInt32LE(0x400, sec + 16); b.writeUInt32LE(0x200, sec + 20); b.writeUInt32LE(0x60000020, sec + 36);
  Buffer.from([0xb8, 1, 0, 0, 0, 0xc2, 12, 0]).copy(b, 0x200); // DllMain
  b[0x210] = 0xb8; b.writeUInt32LE(target, 0x211); b[0x215] = 0xff; b[0x216] = 0xe0;
  b.writeUInt32LE(0x1150, 0x30c); b.writeUInt32LE(1, 0x310); b.writeUInt32LE(1, 0x314);
  b.writeUInt32LE(1, 0x318); b.writeUInt32LE(0x1128, 0x31c);
  b.writeUInt32LE(0x1130, 0x320); b.writeUInt32LE(0x1138, 0x324);
  b.writeUInt32LE(0x1010, 0x328); b.writeUInt32LE(0x1160, 0x330); b.writeUInt16LE(0, 0x338);
  b.write(name + '\0', 0x350); b.write('Probe\0', 0x360);
  return b;
}

function callbackBytes(length, { state = STATE, nested = null } = {}) {
  const bytes = [], emit = (...v) => bytes.push(...v), dword = n => emit(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255);
  const inc = address => { emit(0xff, 0x05); dword(address); };
  const storeEax = address => { emit(0xa3); dword(address); };
  const push = n => { emit(0x68); dword(n); };
  const call = address => { emit(0xb8); dword(address); emit(0xff, 0xd0); };
  emit(0x55, 0x89, 0xe5); // push ebp; mov ebp,esp
  inc(state); emit(0x8b, 0x45, 8); storeEax(state + 4);
  emit(0x8b, 0x45, 12); storeEax(state + 8);
  if (nested) {
    push(nested.macro); push(0x0102); push(nested.path); push(0x5555);
    call(THUNK + (nested.wide ? 8 : 0)); storeEax(state + 28);
  }
  const loop = bytes.length;
  push(1); call(SLEEP); inc(state + 12);
  emit(0x81, 0x3d); dword(state + 12); dword(130);
  emit(0x0f, 0x82); dword(loop - (bytes.length + 4));
  push(0); push(COUNT); push(length); push(BUFFER); emit(0xff, 0x75, 12); call(READ);
  storeEax(state + 16);
  emit(0x8b, 0x45, 8, 0x8b, 0x00); storeEax(state + 20);
  inc(state + 24); emit(0xb8); dword(1); emit(0x5d, 0xc2, 8, 0);
  return Uint8Array.from(bytes);
}

(async () => {
  let ticks = 1000;
  const h = await bootRenderHarness({ fonts: 'none', extraWat, extraHostOverrides: { get_ticks: () => ticks } });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const exe = fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'));
  new Uint8Array(h.memory.buffer).set(exe, e.get_staging()); assert(e.load_pe(exe.length));
  const write = (address, bytes) => bytes.forEach((b, i) => e.guest_write8(address + i, b));
  const payload = Uint8Array.from({ length: 9001 }, (_, i) => (i * 19 + 7) & 255);
  let caseId = 0;
  for (const wide of [false, true]) for (const failure of ['none', 'data', 'dll', 'cancel']) {
    caseId++;
    e.test_help_reset(); e.macro_setup(id('WinHelpA'), id('WinHelpW'), id('ReadFile'), id('Sleep'));
    const base = `c:\\macro${caseId}`, dllName = `probe${caseId}.dll`;
    const hlp = helpFixture(dllName), dll = dllFixture(dllName), opens = [], fills = [];
    const budget = new ChunkCacheBudget({ maxBytes: 0 });
    function mount(name, bytes, kind) {
      vfs.setProviderFile(name, { provider: new ChunkCache({ size: bytes.length,
        readRange: async (off, len) => {
          fills.push([kind, off, len]);
          if (failure === kind && off >= 4096) throw new Error(`injected ${kind} read failure`);
          return bytes.slice(off, off + len);
        },
      }, { chunkSize: 4096, maxChunks: 1, readAhead: 0, budget }) });
    }
    mount(base + '.hlp', hlp, 'hlp'); mount(vfs._resolvePath(dllName), dll, 'dll'); mount(base + '.bin', payload, 'data');
    const create = vfs.createFile.bind(vfs);
    vfs.createFile = (...args) => { opens.push(args[0]); return create(...args); };
    const handle = vfs.createFile(base + '.bin', 0x80000000, 3, 0x80);
    assert.notStrictEqual(handle, -1);
    write(CODE, callbackBytes(payload.length)); write(STATE, new Uint8Array(64));
    write(BUFFER, new Uint8Array(payload.length).fill(0xa5)); e.guest_write32(COUNT, 0xa5a5a5a5);
    write(PATH, Buffer.from(base + '.hlp\0', wide ? 'utf16le' : 'latin1'));
    write(MACRO, Buffer.from(`Probe("durable string",${handle})\0`, wide ? 'utf16le' : 'latin1'));
    [0, 0x4444, PATH, 0x0102, MACRO].forEach((v, i) => e.guest_write32(STACK + i * 4, v));
    e.guest_write32(STACK + 20, 0xfaceb00c); e.macro_begin(wide ? 1 : 0);
    let runs = 0, sleeps = 0, parks = 0, callbackEpoch = null, canceled = false;
    while (e.get_eip()) {
      assert(++runs < 5000, 'durable macro must terminate without reload/replay');
      e.run(1);
      if (e.guest_read32(STATE)) {
        if (callbackEpoch === null) callbackEpoch = e.macro_epoch();
        assert.strictEqual(e.macro_epoch(), callbackEpoch, 'macro continuation cannot reload its source document');
        assert.strictEqual(e.guest_read32(STATE), 1, 'callback entry side effect must occur exactly once');
      }
      if (e.get_sleep_yielded()) { sleeps++; ticks += e.get_sleep_timeout(); }
      if (e.get_yield_reason() === 12) {
        parks++; assert(vfs.pendingRead, 'IO_WAIT must name an owned pending read');
        if (failure === 'cancel' && e.macro_jobs()) {
          assert(e.macro_resolvers(), 'cancellation targets an active DLL preparation');
          assert.strictEqual(e.get_esp(), STACK);
          assert.deepStrictEqual(Array.from({length:5},(_,i)=>e.guest_read32(STACK+i*4)>>>0),
            [0,0x4444,PATH,0x0102,MACRO]);
          e.help_macro_api_cancel_all();
          assert.strictEqual(vfs.pendingRead, null, 'cancel closes the matching pending DLL handle');
          assert.strictEqual(e.guest_read32(STATE), 0);
          canceled = true; break;
        }
        await vfs.fillPendingRead(vfs.pendingRead); e.clear_yield();
      }
    }
    assert.strictEqual(e.macro_jobs(), 0); assert.strictEqual(e.macro_context(), 0); assert.strictEqual(e.macro_resolvers(), 0);
    assert.strictEqual(e.get_esp(), STACK + (canceled ? 0 : 20)); assert.strictEqual(e.guest_read32(STACK + 20) >>> 0, 0xfaceb00c);
    assert.strictEqual(opens.filter(name => String(name).toLowerCase().endsWith(`macro${caseId}.hlp`)).length, 1);
    assert.strictEqual(opens.filter(name => String(name).toLowerCase().endsWith(dllName)).length, 1);
    if (canceled) {
      assert.strictEqual(failure, 'cancel');
    } else if (failure === 'dll') {
      assert.strictEqual(e.get_eax(), 0); assert.strictEqual(e.guest_read32(STATE), 0);
    } else {
      assert.strictEqual(e.get_eax(), 1, JSON.stringify({wide,failure,runs,sleeps,parks,opens,fills,state:Array.from({length:8},(_,i)=>e.guest_read32(STATE+i*4))})); assert.strictEqual(e.guest_read32(STATE + 24), 1);
      assert.strictEqual(e.guest_read32(STATE + 8) >>> 0, handle >>> 0);
      assert.strictEqual(e.guest_read32(STATE + 12), 130); assert.strictEqual(sleeps, 130);
      assert(runs > 64, 'callback must survive beyond the former 64-round native loop');
      assert.strictEqual(e.guest_read32(STATE + 20) >>> 0, Buffer.from('dura').readUInt32LE(0));
      assert.strictEqual(e.guest_read32(STATE + 16), failure === 'data' ? 0 : 1);
      if (failure === 'none') {
        assert.strictEqual(e.guest_read32(COUNT), payload.length);
        assert.deepStrictEqual(Uint8Array.from({ length: payload.length }, (_, i) => e.guest_read8(BUFFER + i)), payload);
      }
    }
    assert(parks >= 3); assert.strictEqual(budget.bytes, 0);
    assert.strictEqual([...vfs.handles.values()].filter(fh => !fh.closed).length, 1, 'only caller-owned data handle remains');
    vfs.closeHandle(handle); vfs.createFile = create;
    console.log(`PASS WinHelp${wide ? 'W' : 'A'} macro ${failure}: ${runs} slices, ${sleeps} Sleep calls, ${parks} IO parks, single document/DLL load`);
  }
  for (const wide of [false, true]) {
    e.test_help_reset(); e.macro_setup(id('WinHelpA'), id('WinHelpW'), id('ReadFile'), id('Sleep'));
    const innerWide = !wide, tag = wide ? 'wa' : 'aw';
    const outerPath = `c:\\nested-${tag}-outer.hlp`, innerPath = `c:\\nested-${tag}-inner.hlp`;
    const outerDll = `n${tag}o.dll`, innerDll = `n${tag}i.dll`;
    const innerState = STATE + 0x100, innerCode = CODE + 0x800;
    const innerPathPtr = PATH + 0x200, innerMacroPtr = MACRO + 0x200;
    const budget = new ChunkCacheBudget({ maxBytes: 0 }), opens = [];
    function mount(name, bytes) {
      vfs.setProviderFile(name, { provider: new ChunkCache({ size: bytes.length,
        async readRange(off, len) { return bytes.slice(off, off + len); },
      }, { chunkSize: 4096, maxChunks: 1, readAhead: 0, budget }) });
    }
    mount(outerPath, helpFixture(outerDll)); mount(innerPath, helpFixture(innerDll));
    mount(vfs._resolvePath(outerDll), dllFixture(outerDll));
    mount(vfs._resolvePath(innerDll), dllFixture(innerDll, innerCode));
    mount(`c:\\nested-${tag}.bin`, payload);
    const outerHandle = vfs.createFile(`c:\\nested-${tag}.bin`, 0x80000000, 3, 0x80);
    const innerHandle = vfs.createFile(`c:\\nested-${tag}.bin`, 0x80000000, 3, 0x80);
    const create = vfs.createFile.bind(vfs);
    vfs.createFile = (...args) => { opens.push(String(args[0]).toLowerCase()); return create(...args); };
    write(STATE, new Uint8Array(0x140));
    write(CODE, callbackBytes(payload.length, { nested: { path: innerPathPtr, macro: innerMacroPtr, wide: innerWide } }));
    write(innerCode, callbackBytes(payload.length, { state: innerState }));
    write(PATH, Buffer.from(outerPath + '\0', wide ? 'utf16le' : 'latin1'));
    write(MACRO, Buffer.from(`Probe("outer owned string",${outerHandle})\0`, wide ? 'utf16le' : 'latin1'));
    write(innerPathPtr, Buffer.from(innerPath + '\0', innerWide ? 'utf16le' : 'latin1'));
    write(innerMacroPtr, Buffer.from(`Probe("inner owned string",${innerHandle})\0`, innerWide ? 'utf16le' : 'latin1'));
    [0, 0x4444, PATH, 0x0102, MACRO].forEach((v, i) => e.guest_write32(STACK + i * 4, v));
    e.guest_write32(STACK + 20, 0xfaceb00c); e.macro_begin(wide ? 1 : 0);
    let runs = 0, sleeps = 0, parks = 0, outerEpoch = null, innerEpoch = null, sawNestedJobs = false;
    while (e.get_eip()) {
      assert(++runs < 10000, 'nested callback must finish without replay'); e.run(1);
      const head = e.macro_jobs();
      if (head && e.guest_read32(head)) sawNestedJobs = true;
      if (e.guest_read32(STATE) && outerEpoch === null) outerEpoch = e.macro_epoch();
      if (e.guest_read32(innerState) && innerEpoch === null) innerEpoch = e.macro_epoch();
      if (e.get_sleep_yielded()) { sleeps++; ticks += e.get_sleep_timeout(); }
      if (e.get_yield_reason() === 12) {
        parks++; assert(vfs.pendingRead); await vfs.fillPendingRead(vfs.pendingRead); e.clear_yield();
      }
    }
    assert(sawNestedJobs, 'distinct actual API frames retain two linked jobs');
    assert.notStrictEqual(innerEpoch, outerEpoch, 'inner WinHelp replaces the routine registry/document');
    assert.strictEqual(e.macro_epoch(), innerEpoch, 'outer resume never reloads its old document');
    for (const [state, prefix] of [[STATE, 'oute'], [innerState, 'inne']]) {
      assert.strictEqual(e.guest_read32(state), 1, 'each callback enters once');
      assert.strictEqual(e.guest_read32(state + 24), 1, 'each callback completes once');
      assert.strictEqual(e.guest_read32(state + 12), 130);
      assert.strictEqual(e.guest_read32(state + 16), 1);
      assert.strictEqual(e.guest_read32(state + 20) >>> 0, Buffer.from(prefix).readUInt32LE(0),
        'owned argument survives inner document replacement and callback waits');
    }
    assert.strictEqual(e.guest_read32(STATE + 28), 1, 'nested API returns success to outer callback');
    assert.strictEqual(sleeps, 260); assert(parks >= 6); assert(runs > 128);
    assert.strictEqual(e.get_eax(), 1); assert.strictEqual(e.get_esp(), STACK + 20);
    assert.strictEqual(e.guest_read32(STACK + 20) >>> 0, 0xfaceb00c);
    assert.strictEqual(e.macro_jobs(), 0); assert.strictEqual(e.macro_context(), 0); assert.strictEqual(e.macro_resolvers(), 0);
    for (const name of [outerPath, innerPath, outerDll, innerDll]) {
      assert.strictEqual(opens.filter(open => open.endsWith(name.replace(/^c:\\\\/, ''))).length, 1, `${name} opens once`);
    }
    assert.strictEqual(budget.bytes, 0);
    assert.strictEqual([...vfs.handles.values()].filter(fh => !fh.closed).length, 2);
    vfs.closeHandle(outerHandle); vfs.closeHandle(innerHandle); vfs.createFile = create;
    console.log(`PASS nested WinHelp${wide ? 'W→A' : 'A→W'}: ${runs} slices, ${sleeps} Sleeps, ${parks} IO parks, owned arguments survive replacement`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
