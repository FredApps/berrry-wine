'use strict';

// Explicit synthetic CPU setup, then actual x86 CALL/RETF instructions. This
// tests the real/VM86 fallback, not IRET entry to VM86 or privilege exception
// delivery. Each operand size and immediate/memory CALL form checks the actual
// frame bytes and restored selector/base/SP. No proprietary assets.
const assert = require('node:assert/strict');
const { makeVm } = require('../tools/toyvm/vm');
const { decodeOne, setCpuLevel } = require('../tools/toyvm/decode');
const { HANDLERS } = require('../tools/toyvm/emit');
const word = n => [n & 255, (n >>> 8) & 255];
const dword = n => [...word(n), ...word(n >>> 16)];

async function main() {
  const vm = await makeVm('tailcall');
  // Like run-dos/live, configure BOTH decoder and WASM CPU level. stepOne
  // otherwise interprets66 as an8086 conditional-jump alias, not a prefix.
  setCpuLevel(386);
  const checkDecode = (expected, length) => {
    const d = decodeOne(a => vm.mem[a], vm.get('cs'), vm.get('gip'));
    assert(d); assert.equal(HANDLERS[d.words[0]].name, expected, 'actual decoded handler');
    assert.equal(d.length, length, 'actual encoded instruction length');
  };
  const ex = vm.exports;
  const view = new DataView(vm.memory.buffer);
  let cases = 0;
  for (const mode of ['real', 'vm86']) for (const width of [2, 4]) {
    for (const memory of [false, true]) for (const release of [0, 6]) {
      const name = `${mode}-${width * 8}-${memory ? 'memory' : 'direct'}-release${release}`;
      ex.set_cpu(386);
      ex.mset_cr0(mode === 'vm86' ? 1 : 0);
      ex.mset_vm86(mode === 'vm86' ? 1 : 0);
      ex.mset_pm_xfer_stop(0);
      vm.set('cs', 0x1000); vm.set('ss', 0x2000);
      vm.set('sp', 0x2000); vm.set('gip', 0x100); vm.set('flags', 0x3003);
      assert.equal(ex.get_csb(), 0x10000, name + ': initial CS paragraph base');
      assert.equal(ex.get_ssb(), 0x20000, name + ': initial SS paragraph base');
      assert.equal(ex.get_d32(), 0); assert.equal(ex.mget_spm() >>> 0, 0xffff);
      assert.equal(ex.get_vm86(), mode === 'vm86' ? 1 : 0);
      assert.equal(ex.get_cr0() & 1, mode === 'vm86' ? 1 : 0);
      const prefix = width === 4 ? [0x66] : [];
      const call = memory
        ? [...prefix, 0x2e, 0xff, 0x1e, ...word(0x180)]
        : [...prefix, 0x9a, ...(width === 4 ? dword(0x200) : word(0x200)), ...word(0x3000)];
      vm.mem.set(call, 0x10100);
      vm.mem.set([...(width === 4 ? dword(0x200) : word(0x200)), ...word(0x3000)], 0x10180);
      vm.mem.set([...prefix, ...(release ? [0xca, ...word(release)] : [0xcb])], 0x30200);
      vm.mem.fill(0xa5, 0x21fe0, 0x22010);
      checkDecode(memory ? (width === 4 ? 'call_far_m32' : 'call_far_m') : (width === 4 ? 'call_far32' : 'call_far'), call.length);
      assert.equal(vm.stepOne(), true, name + ': CALL decoded');
      assert.equal(vm.get('cs'), 0x3000); assert.equal(vm.get('gip'), 0x200);
      assert.equal(ex.get_csb(), 0x30000);
      assert.equal(vm.get('sp'), 0x2000 - 2 * width);
      const read = at => width === 4 ? view.getUint32(at, true) : view.getUint16(at, true);
      assert.equal(read(0x22000 - 2 * width), 0x100 + call.length, name + ': return offset');
      assert.equal(read(0x22000 - width), 0x1000, name + ': return selector');
      assert.equal(vm.mem[0x22000 - 2 * width - 1], 0xa5, name + ': frame lower sentinel');
      assert.equal(vm.mem[0x22000], 0xa5, name + ': frame upper sentinel');
      checkDecode('retf' + (release ? '_imm' : '') + (width === 4 ? '32' : ''), prefix.length + (release ? 3 : 1));
      assert.equal(vm.stepOne(), true, name + ': RETF decoded');
      assert.equal(vm.get('cs'), 0x1000); assert.equal(vm.get('gip'), 0x100 + call.length);
      assert.equal(ex.get_csb(), 0x10000); assert.equal(vm.get('ss'), 0x2000);
      assert.equal(vm.get('sp'), 0x2000 + release); assert.equal(vm.get('flags') & 1, 1);
      assert.equal(ex.mget_pm_xfer_stop(), 0, name + ': no protected-transfer interception');
      console.log('PASS ' + name); cases++;
    }
  }
  console.log(`PASS ${cases} real/VM86 actual CALL/RETF fallback contracts`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
