'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DosSession } = require('../tools/toyvm/dos-loop');
const { runDos } = require('../tools/toyvm/run-dos');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-progress-'));
  const original = DosSession.prototype.checkProgress;
  let reads = 0, cells = 0, calls = 0, session;
  DosSession.prototype.checkProgress = function (...args) {
    session = this;
    calls++;
    const get = this.vm.get;
    this.vm.get = (...a) => { reads++; return get.apply(this.vm, a); };
    this.cells = () => { cells++; return 0; };
    try { return original.apply(this, args); }
    finally { this.vm.get = get; }
  };
  const run = async (name, bytes, opts = {}) => {
    const exe = path.join(dir, name + '.COM');
    fs.writeFileSync(exe, Buffer.from(bytes));
    return runDos({ exe, budget: 20000, log: () => {}, slice: 8,
      stuckLimit: 0, ...opts });
  };
  try {
    // Real guest work: BIOS output, a changing register loop, then normal exit.
    const program = [0xb4,0x0e,0xb0,0x41,0xcd,0x10,
      0xb9,0xe8,0x03,0x43,0xe2,0xfd,0xcd,0x20];
    const disabled = await run('WORK', program);
    assert(calls > 2, 'execution must exercise repeated real handbacks');
    assert.equal(reads, 0, 'disabled detector must not read diagnostic registers');
    assert.equal(cells, 0, 'disabled detector must not score the console');
    // Direct callers get the same disabled behavior, even on refused entries.
    const before = [session.stuck, session.lastKey, session.lastRegs, session.lastWritten];
    const get = session.vm.get;
    const con = session.machine.con;
    Object.defineProperty(session.machine, 'con', {
      configurable: true, get() { throw Error('diagnostic console read'); },
    });
    session.vm.get = () => { throw Error('diagnostic register read'); };
    try { original.call(session, 0, 0, true); }
    finally {
      session.vm.get = get;
      Object.defineProperty(session.machine, 'con', { configurable: true, writable: true, value: con });
    }
    assert.deepEqual([session.stuck, session.lastKey, session.lastRegs, session.lastWritten], before);
    const hash = r => crypto.createHash('sha256').update(r.vm.mem).digest('hex');
    const state = r => Object.fromEntries(Object.entries(r.vm.exports)
      .filter(([name, fn]) => name.startsWith('get_') && typeof fn === 'function' && fn.length === 0)
      .map(([name, fn]) => [name, fn()]));
    const disabledHash = hash(disabled);
    const disabledRegs = state(disabled);
    const enabled = await run('WORK', program, { stuckLimit: 3, stuckWork: 0 });
    assert(reads > 0 && cells > 0, 'enabled detector must observe progress');
    assert.equal(enabled.stuckAt, null);
    assert.equal(enabled.machine.exited, true);
    assert.equal(hash(enabled), disabledHash, 'detector setting must preserve guest memory');
    assert.deepEqual(state(enabled), disabledRegs);
    assert.equal(enabled.dispatched, disabled.dispatched);
    assert.equal(enabled.handbacks, disabled.handbacks);
    // Same entry and register values on successive BIOS calls: output alone
    // must keep a legitimate writer alive, even with the work floor disabled.
    const writer = await run('WRITER', [0xb4,0x0e,0xb0,0x41,0xcd,0x10,0xeb,0xfc],
      { stuckLimit: 3, stuckWork: 0 });
    assert.equal(writer.stuckAt, null);
    assert(writer.machine.con.written > 100);
    assert(writer.dispatched >= 20000);
    const spin = await run('SPIN', [0xeb,0xfe], { stuckLimit: 3, stuckWork: 100 });
    assert(spin.stuckAt, 'enabled detector must stop a real spin');
    assert(spin.dispatched > 100 && spin.dispatched < 20000, 'work floor remains effective');
    const refused = await run('REFUSED', [0x63,0x01], { stuckLimit: 3, stuckWork: 1e9 });
    assert(refused.stuckAt, 'refused entry must bypass the work floor');
    assert(refused.handbacks < 20);
    console.log('PASS disabled diagnostic work, direct call, guest equivalence, enabled progress/spin/refusal');
  } finally {
    DosSession.prototype.checkProgress = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
