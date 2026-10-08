'use strict';
// Private diagnostic overlay only. Decode the existing --trace-win16 stream;
// never confuse its API-handler exit with a guest callback's RETF.
const MARKERS = Object.freeze({0xca16a9eb: ['route', 6], 0xca16a9f0: ['call', 15], 0xca16a9ef: ['handler-exit', 6]});
const INPUT = new Set([0x201, 0x202, 0x203, 0x111, 0x20, 0x21, 0x84]);
const USER = new Set([18, 19, 22, 23, 28, 29, 50, 53, 76, 87, 107, 108, 111, 114, 122, 124, 218, 219]);

function createObserver({getExports, getMemory, slot, now = Date.now, baselineTrace, maxRows = 128, maxBytes = 32768, durationMs = 8000}) {
  if (baselineTrace !== 0) throw Error('pinned trace-disabled baseline required');
  if (!Number.isInteger(maxRows) || maxRows < 4 || maxRows > 256 || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 32768 || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 8000) throw Error('observer bounds');
  let active = false, ever = false, deadline = 0, pending = null, lastCall = null, phase = 'down', context = false;
  let errors = 0, reason = null, unknown = 0, traceWords = 0;
  let flagRestoreError = null;
  const rows = [], bytes = {down: 0, up: 0}, counts = {down: 0, up: 0}, omitted = {down: 0, up: 0}, half = Math.floor(maxBytes / 2);
  function stop(why) { const restore = active; active = false; pending = null; if(restore||reason===null)reason = why; if(restore)try{getExports().set_win16_trace(0);}catch(e){errors++;flagRestoreError=String(e);} }
  function live() { if (active && now() >= deadline) stop('deadline'); return active; }
  function guard() {if(!live())throw Error('observer deadline');}
  function checked(fn) {guard();const value=fn();guard();return value;}
  function snapshot(record) {
    const e = checked(getExports), result = {};
    for (const n of ['get_current_thread_id', 'get_eip', 'get_esp', 'get_ebp', 'get_eax', 'get_edx', 'get_sreg_cs', 'get_sreg_ss', 'get_sreg_ds', 'win16_last_module', 'win16_last_ordinal']) result[n] = checked(()=>e[n]()) >>> 0;
    const buffer=checked(getMemory);
    function span(guest, length) {
      if (bytes[phase] + length > half) return {omitted: 'phase byte cap'};
      const wa = checked(()=>e.guest_to_wasm(guest)) >>> 0;
      if (wa < 256 || wa + length > buffer.byteLength) throw Error('unmapped span');
      guard();
      bytes[phase] += length;
      return {guest, wasm: wa, bytes: Array.from(new Uint8Array(buffer, wa, length))};
    }
    const ss = result.get_sreg_ss >>> 3, cs = result.get_sreg_cs >>> 3;
    result.ssBase = checked(()=>e.win16_seg_base(ss)) >>> 0; result.ssLimit = checked(()=>e.win16_seg_limit(ss)) >>> 0;
    result.csBase = checked(()=>e.win16_seg_base(cs)) >>> 0; result.csLimit = checked(()=>e.win16_seg_limit(cs)) >>> 0;
    const sp = result.get_esp - result.ssBase, bp = result.get_ebp & 0xffff;
    if (sp >= 0 && sp + 96 <= result.ssLimit) result.stack = span(result.get_esp, 96);
    if (bp >= 32 && bp + 96 <= result.ssLimit) result.frame = span(result.ssBase + bp - 32, 128);
    if (record.kind === 'call' && record.words[0] === 0x2004c) {
      const offset = record.words[4] & 0xffff, selector = record.words[5] & 0xffff;
      const limit = checked(()=>e.win16_seg_limit(selector >>> 3)) >>> 0;
      if (selector && offset + 8 <= limit) result.ptInRect = {x: (record.words[2] << 16) >> 16, y: (record.words[3] << 16) >> 16, selector, offset, rect: span((checked(()=>e.win16_seg_base(selector >>> 3)) >>> 0) + offset, 8)};
    }
    // ret_lin is a guest linear address from win16_dispatch, not EIP, which
    // can still name the start of the block that pushed the API arguments.
    const ret = record.kind === 'call' ? record.words[1] : result.get_eip;
    if (ret >= result.csBase + 48 && ret + 48 <= result.csBase + result.csLimit) result.caller = span(ret - 48, 96);
    return result;
  }
  function add(record, heavy = false) {
    if (!live()) return;
    if (counts[phase] >= Math.floor(maxRows / 2)) { omitted[phase]++; return; }
    const row = {...record, slot, phase, at: now()};
    if (heavy && bytes[phase] < half) { try { row.owner = snapshot(record); } catch (e) { errors++; row.error = String(e); } }
    rows.push(row); counts[phase]++;
  }
  function input(packed) {
    const msg = packed & 0xffff;
    if (!ever && msg === 0x201) {
      ever = true; active = true; deadline = now() + durationMs;
      getExports().set_win16_trace(1); // Sole setter: existing diagnostic flag.
    }
    if (live() && (msg === 0x201 || msg === 0x202)) {
      if (msg === 0x202) phase = 'up';
      add({kind: 'input-poll', packed: packed >>> 0});
    }
  }
  function word(value) {
    if (!live()) return;
    traceWords++; const v = value >>> 0;
    if (!pending) {
      const type = MARKERS[v];
      if (type) pending = {kind: type[0], want: type[1], words: []}; else unknown++;
      return;
    }
    pending.words.push(v);
    if (pending.words.length !== pending.want) return;
    const record = pending; pending = null; delete record.want;
    if (record.kind === 'route') {
      context = INPUT.has(record.words[1]);
      if (record.words[1] === 0x202) phase = 'up';
      if (context) add(record, true);
    } else if (record.kind === 'call') {
      const module = record.words[0] >>> 16, ordinal = record.words[0] & 0xffff;
      // Filter BEFORE any owner getter or memory read. Idle/paint never spends
      // the release budget. Capture KERNEL calls only within an input route.
      const messageApi = module === 2 && [107, 111, 122].includes(ordinal);
      lastCall = context && (!messageApi || INPUT.has(record.words[5])) && (module === 1 || (module === 2 && USER.has(ordinal))) ? record.words[0] : null;
      if (lastCall !== null) add(record, true);
    } else if (lastCall !== null) { add({...record, apiKey: lastCall}); lastCall = null; }
  }
  return {input, word, stop, fail() {errors++; stop('observer error');}, importValue(name, value) { if (live()) add({kind: name, value: value >>> 0}); }, status: () => ({active: live(), ever, reason, deadline, bytes: {...bytes}, omitted: {...omitted}, errors, flagRestoreError, unknown, traceWords, incomplete: pending, rows: rows.slice(), limitation: 'route precedes callback; call frames can establish guest consumption only after original-code authentication; handler-exit is not callback return'})};
}

function install(host, options) {
  const observer = createObserver(options), originals = {}, wrappers = {}, names = ['check_input', 'log_i32', 'check_input_hwnd', 'check_input_lparam'];
  for (const name of names) {
    const original = host[name]; if (typeof original !== 'function') throw Error('missing import ' + name);
    originals[name] = original;
  }
  for (const name of names) {
    const original=originals[name];
    wrappers[name] = host[name] = function (...args) {
      // Preserve the original receiver, result, exception and call count.
      const result = Reflect.apply(original, this, args);
      try { if (name === 'check_input') observer.input(result); else if (name === 'log_i32') observer.word(args[0]); else observer.importValue(name, result); } catch (_) { try { observer.fail(); } catch (_) {} }
      return result;
    };
  }
  return {status: observer.status, stop() { observer.stop('explicit stop'); for (const [n, f] of Object.entries(originals)) if(host[n]===wrappers[n])host[n] = f; }};
}

function overlay(workerSource, helperSource) {
  const anchor = '      installWaveRegistrationImports(built.imports.host);';
  if (workerSource.split(anchor).length !== 2) throw Error('Worker anchor drift');
  // Both main and auxiliary Workers instantiate through this same boundary.
  // WorkerLink has no 'log' handler. A matching private link overlay below
  // retains the structured receipt and forwards it through the link logger.
  const injected = `${anchor}\n      if(workerSlot<2){\n      const antaraProbe = self.AntaraWin16Callback.install(built.imports.host, {getExports:()=>instance.exports, getMemory:()=>memory.buffer, slot:workerSlot, baselineTrace:0});\n      rawSend({t:'antaraWin16Receipt',receipt:antaraProbe.status()});\n      const antaraAbsoluteDeadline=Date.now()+120000;\n      const antaraTimer = setInterval(()=>{const row=antaraProbe.status(); if((row.ever&&!row.active)||Date.now()>=antaraAbsoluteDeadline){clearInterval(antaraTimer); antaraProbe.stop(); rawSend({t:'antaraWin16Receipt',receipt:antaraProbe.status()});}},100);\n      }`;
  return helperSource + '\n' + workerSource.replace(anchor, injected);
}
function linkOverlay(source) {
  const anchor = '    _onMessage(msg) {\n      switch (msg.t) {';
  if (source.split(anchor).length !== 2) throw Error('WorkerLink anchor drift');
  return source.replace(anchor, `    _onMessage(msg) {\n      if(msg.t==='antaraWin16Receipt'){this.antaraWin16Receipt=msg.receipt; this.log('[antara-win16-callback] '+JSON.stringify({slot:this.slot,ever:msg.receipt.ever,reason:msg.receipt.reason,rows:msg.receipt.rows.length,bytes:msg.receipt.bytes,errors:msg.receipt.errors})); return;}\n      switch (msg.t) {`);
}
const api = {createObserver, install, overlay, linkOverlay, MARKERS};
if (typeof module !== 'undefined') module.exports = api;
if (typeof self !== 'undefined') self.AntaraWin16Callback = api;
