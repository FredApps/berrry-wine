'use strict';
function installEmissionObserver(host, getOwner, emit, clock = () => performance.timeOrigin + performance.now()) {
  const originals = { glide_submit: host.glide_submit, get_key_down_state: host.get_key_down_state, log: host.log };
  if (Object.values(originals).some(f => typeof f !== 'function')) throw Error('real import missing');
  let armedAt = null, events = 0, swaps = 0, closed = false, overflow = false, drawEntries = 0, drawsSinceSwap = 0, drawErrors = 0;
  const report = record => { try { emit(record); } catch (_) {} };
  function readGuest(ex, memory, pureG2w, imageBase, address, size) {
    if (!Number.isInteger(address) || address < 256 || address + size > 0x100000000) return { absent: 'invalid guest range' };
    const buffer = memory.buffer, bytes = new Uint8Array(buffer), out = [], mappings = [];
    for (let i = 0; i < size; i++) {
      const wa = pureG2w(address + i, imageBase, buffer) >>> 0;
      if (wa < 256 || wa >= bytes.length) return { absent: 'unmapped guest byte', address: address + i };
      mappings.push(wa); out.push(bytes[wa]);
    }
    if (memory.buffer !== buffer || (ex.get_image_base() >>> 0) !== imageBase) return { absent: 'mapping identity changed' };
    for (let i = 0; i < size; i++) if ((pureG2w(address + i, imageBase, buffer) >>> 0) !== mappings[i]) return { absent: 'mapping changed during read' };
    return { address, hex: out.map(v => v.toString(16).padStart(2, '0')).join('') };
  }
  function snapshot(op, ptr, length) {
    const { ex, memory, slot, pureG2w } = getOwner();
    if (!ex || !memory || typeof pureG2w !== 'function' || !Number.isInteger(slot)) throw Error('unattributed owning instance');
    const regs = {};
    for (const n of ['get_current_thread_id', 'get_eip', 'get_esp', 'get_image_base']) regs[n] = ex[n]() >>> 0;
    if (!regs.get_eip || !regs.get_esp) throw Error('inactive owning instance');
    if (![op, ptr, length].every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff) || length > 1048576 || ptr + length > memory.buffer.byteLength) throw Error('packet bounds');
    const packet = new Uint8Array(memory.buffer, ptr, length), view = new DataView(memory.buffer, ptr, length);
    const hex = (start, size) => Array.from(packet.subarray(start, start + size), b => b.toString(16).padStart(2, '0')).join('');
    const counts = {}, records = []; let offset = 0, count = 0;
    if (op === 0) while (offset < length) {
      if (++count > 4096 || length - offset < 8) throw Error('record cap/truncated header');
      const kind = view.getUint32(offset, true), n = view.getUint32(offset + 4, true), padded = Math.ceil(n / 4) * 4;
      if (padded > length - offset - 8) throw Error('truncated record');
      counts[kind] = (counts[kind] || 0) + 1;
      if (records.length < 24) records.push({ offset, kind, bytes: n, statePrefixHex: hex(offset + 8, Math.min(n, 256)), payloadHex: n <= 516 ? hex(offset + 8, n) : null });
      offset += 8 + padded;
    }
    return { slot, regs, flushStack: readGuest(ex, memory, pureG2w, regs.get_image_base, regs.get_esp, 192), code: readGuest(ex, memory, pureG2w, regs.get_image_base, regs.get_eip, 48), opcode: op, packetWa: ptr, packetBytes: length, counts, recordCount: count, records, directPrefixHex: op === 0 ? null : hex(0, Math.min(length, 256)), attribution: 'actual emitting instance; batch stack is flush caller only; raw stack words are not authenticated returns' };
  }
  function key(...args) {
    const value = Reflect.apply(originals.get_key_down_state, this, args);
    try { if (!closed && armedAt === null && (args[0] & 255) === 32 && (value & 0x8000)) { armedAt = clock(); report({ kind: 'arm', at: armedAt, reason: 'actual guest observed ordinary Space down' }); } } catch (_) { report({ kind: 'observer-error', error: 'arm clock failed' }); }
    return value;
  }
  function submit(...args) {
    let record;
    try { if (!closed && armedAt !== null && swaps < 8 && clock() - armedAt < 3000) {
      if (events < 40) {
        events++;
        try { record = { kind: 'emission', ordinal: events, at: clock(), ...snapshot(...args) }; }
        catch (e) { record = { kind: 'observer-error', ordinal: events, error: String(e) }; }
      } else if (!overflow) { overflow = true; report({ kind: 'cap', events }); }
    }
    } catch (_) { report({ kind: 'observer-error', error: 'capture clock failed' }); }
    try { const result = Reflect.apply(originals.glide_submit, this, args); if (record) { record.result = result; try { record.endAt = clock(); } catch (_) { record.clockError = true; } report(record); } if (armedAt !== null && args[0] === 4) { swaps++; drawsSinceSwap = 0; } return result; }
    catch (e) { if (record) { record.originalError = String(e); report(record); } throw e; }
  }
  function log(...args) {
    const result = Reflect.apply(originals.log, this, args);
    try {
      if (closed || armedAt === null || swaps >= 8 || events >= 40 || drawEntries >= 32 || clock() - armedAt >= 3000) return result;
      const { memory } = getOwner(), [ptr, len] = args;
      if (!Number.isInteger(ptr) || !Number.isInteger(len) || ptr < 256 || len < 1 || len > 96 || ptr + len > memory.buffer.byteLength) return result;
      const name = String.fromCharCode(...new Uint8Array(memory.buffer, ptr, len));
      if (!/^_?grDraw(?:Triangle|VertexArray|VertexArrayContiguous|Point|Line)(?:@\d+)?$/.test(name)) return result;
      if (++drawsSinceSwap > 4) return result;
      drawEntries++;
      report({ ...snapshot(0, 0, 0), kind: 'draw-entry', api: name, drawEntry: drawEntries, afterSwap: swaps, at: clock(), attribution: 'actual API-entry owner before handler, stack first word is candidate guest return; authenticate against exact binary' });
    } catch (e) { if (drawErrors++ < 8) report({ kind: 'draw-observer-error', error: String(e) }); }
    return result;
  }
  host.get_key_down_state = key; host.glide_submit = submit; host.log = log;
  return { close() { if (closed) return; closed = true; for (const [n, f] of Object.entries({ glide_submit: submit, get_key_down_state: key, log })) { if (host[n] === f) host[n] = originals[n]; else report({ kind: 'cleanup-error', name: n, error: 'foreign replacement preserved' }); } }, summary() { return { armedAt, events, swaps, drawEntries, overflow, closed }; } };
}
module.exports={installEmissionObserver};
