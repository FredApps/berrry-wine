'use strict';

// Passive owning-instance imports. No trace flags, guest writes or CPU polling.
function installExitFaultObserver(host, getState, emit, options = {}) {
  const now = options.now || Date.now;
  const durationMs = options.durationMs ?? 300000;
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 300000)
    throw Error('Observer duration must be 1..300000 ms');
  for (const name of ['exit', 'log_i32'])
    if (typeof host[name] !== 'function') throw Error(`Missing real ${name} import`);
  const originals = {exit: host.exit, log_i32: host.log_i32};
  const deadline = now() + durationMs;
  const counts = {faults: 0, exits: 0, readBytes: 0, errors: [], expired: false};
  let pending = [], stopped = false;
  function live() {
    if (stopped || now() >= deadline) { counts.expired = !stopped; return false; }
    return true;
  }
  function guard() { if (!live()) throw Error('Observer deadline'); }
  function report(record) { try { emit(record); } catch (e) { error(e); } }
  function error(e) { if (counts.errors.length < 8) counts.errors.push(String(e).slice(0,256)); }
  function snapshot(kind, values) {
    const record = {kind, ...values};
    try {
      guard();
      const state = getState(); guard();
      const ex = state.ex;
      const regs = record.regs = {};
      for (const name of ['get_current_thread_id', 'get_image_base', 'get_eip',
        'get_esp', 'get_ebp', 'get_eax', 'get_ebx', 'get_ecx', 'get_edx', 'get_esi', 'get_edi']) {
        guard(); regs[name] = ex[name]() >>> 0; guard();
      }
      function read(address, length) {
        guard();
        if (!Number.isSafeInteger(address) || address < 1 || address + length > 0x100000000)
          return {address, length, invalid: true};
        const bytes = [];
        for (let i = 0; i < length; i++) {
          guard();
          if (counts.readBytes >= 16384) return {address, length, capped: true};
          const wa = ex.guest_to_wasm((address + i) >>> 0) >>> 0; guard();
          const buffer = state.memory.buffer; guard();
          if (wa < 256 || wa >= buffer.byteLength) return {address, length, unmapped: true};
          bytes.push(new Uint8Array(buffer, wa, 1)[0]); counts.readBytes++;
        }
        return {address, length, hex: bytes.map(v => v.toString(16).padStart(2,'0')).join('')};
      }
      // ExitProcess has already popped return/code before calling host.exit.
      record.stack = read(regs.get_esp - (kind === 'exit' ? 8 : 0), 192);
      record.frame = read(regs.get_ebp - 32, 128);
      record.codeSpan = read(values.eip ?? regs.get_eip, 96);
      if (kind === 'exit' && record.stack.hex) {
        record.returnAddress = parseInt(record.stack.hex.slice(0,8).match(/../g).reverse().join(''),16) >>> 0;
        record.returnCode = read(record.returnAddress - 32, 96);
      }
    } catch (e) { record.error = String(e).slice(0,256); error(e); }
    report(record);
  }
  const wrappers = {
    log_i32: function (...args) {
      try {
        if (live() && counts.faults < 4) {
          const value = args[0] >>> 0;
          if (value === 0xcae8c000) pending = [value];
          else if (pending.length) {
            pending.push(value);
            if (pending.length === 3) {
              const [,code,eip] = pending; pending = []; counts.faults++;
              snapshot('fault', {code,eip,ordinal:counts.faults});
            }
          }
        }
      } catch (e) { error(e); }
      return Reflect.apply(originals.log_i32, this, args);
    },
    exit: function (...args) {
      try {
        if (live() && counts.exits < 2) {
          counts.exits++; snapshot('exit', {code:args[0] >>> 0,ordinal:counts.exits});
          report({kind:'summary', ...summary()});
        }
      } catch (e) { error(e); }
      return Reflect.apply(originals.exit, this, args);
    },
  };
  function summary() { return {...counts, errors:[...counts.errors], pending:[...pending], deadline}; }
  host.log_i32 = wrappers.log_i32; host.exit = wrappers.exit;
  return {summary, stop() {
    stopped = true;
    for (const name of ['exit','log_i32']) if (host[name] === wrappers[name]) host[name] = originals[name];
    return summary();
  }};
}

function overlayWorker(source) {
  const anchor = '      const result = await WebAssembly.instantiate(msg.module, built.imports);';
  if (source.split(anchor).length !== 2) throw Error('Worker instantiate anchor drift');
  const hook = `      (${installExitFaultObserver.toString()})(built.imports.host, () => ({ex:instance.exports,memory}), record => console.log('[crimson-owning-exit-fault] '+JSON.stringify(record)));\n`;
  return source.replace(anchor, hook + anchor);
}

module.exports = {installExitFaultObserver, overlayWorker};
