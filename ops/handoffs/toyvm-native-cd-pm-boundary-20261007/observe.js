'use strict';
function observer({ maxRecords = 32 } = {}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 32) throw Error('maxRecords must be 1..32');
  const rows = [], errors = [], seen = new Set(); let calls = 0, capped = false;
  function entry(session) {
    if (capped) return;
    calls++;
    try {
      const vm = session.vm, ex = vm.exports, mem = vm.mem;
      const cr0 = ex.get_cr0() >>> 0;
      if (!(cr0 & 1)) return;
      const cs = vm.get('cs') >>> 0, ip = vm.get('gip') >>> 0;
      const cr3Count = ex.diag_get_cr3_count() >>> 0;
      const key = [cs, ip, cr0, cr3Count].join(':');
      if (seen.has(key)) return;
      if (rows.length >= maxRecords) { capped = true; return; }
      seen.add(key);
      const read = (at, n) => {
        if (!Number.isSafeInteger(at) || at < 0 || at > 0xffffffff || !Number.isSafeInteger(n) || n < 0 || n > 256 || at + n > mem.byteLength) return { at, n, valid: false };
        return { at, n, valid: true, hex: Buffer.from(mem.subarray(at, at + n)).toString('hex') };
      };
      const gdt = ex.get_gdtb() >>> 0, gdtLimit = ex.get_gdtl() >>> 0, ldt = ex.mget_ldtb() >>> 0, ldtSelector = ex.mget_ldt() >>> 0;
      const selectors = {};
      for (const reg of ['cs', 'ss', 'ds', 'es', 'fs', 'gs']) {
        const value = vm.get(reg) >>> 0, table = value & 4 ? ldt : gdt;
        selectors[reg] = { value, table: value & 4 ? 'ldt' : 'gdt',
          descriptorMeaning: 'raw mapped bytes only; not architectural descriptor validity',
          descriptor: (value & 4) && !(ldtSelector & 0xfff8)
            ? { valid: false, reason: 'inactive LDTR' } : read(table + (value & 0xfff8), 8) };
      }
      const csb = ex.get_csb() >>> 0;
      rows.push({ at: new Date().toISOString(), boundary: 'before actual DosSession.step; not instruction checkpoint', handbacks: session.handbacks, dispatched: session.dispatched,
        cs, ip, cr0, pagingBit: !!(cr0 & 0x80000000), csb, d32: ex.get_d32(), vm86: ex.get_vm86(),
        lastAttemptedCr3Write: cr3Count ? ex.diag_get_cr3_last() >>> 0 : null, cr3WriteCount: cr3Count,
        cr3Meaning: 'observed MOV CR3 operand only; original engine still discards this write, no architectural CR3/paging supplied',
        gdtr: { base: gdt, limit: gdtLimit }, ldtr: { selector: ldtSelector, base: ldt, active: !!(ldtSelector & 0xfff8) },
        gdtBytes: read(gdt, Math.min(128, gdtLimit + 1)), ldtBytes: (ldtSelector & 0xfff8) ? read(ldt, 64) : { valid: false, reason: 'inactive LDTR' }, selectors,
        code: read(csb + ip, 32), flags: vm.get('flags') >>> 0,
      });
    } catch (e) { if (errors.length < 8) errors.push(String(e)); }
  }
  function install(prototype) {
    const original = prototype.step;
    function wrapped(...args) { entry(this); return Reflect.apply(original, this, args); }
    prototype.step = wrapped;
    return () => {
      if (prototype.step !== wrapped) { if (errors.length < 8) errors.push('foreign step replacement; not overwritten'); return false; }
      prototype.step = original; return true;
    };
  }
  return { entry, install, result: () => ({ rows, errors, calls, capped, maxRecords }) };
}
module.exports = { observer };
