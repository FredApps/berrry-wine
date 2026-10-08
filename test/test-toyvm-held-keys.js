'use strict';
const assert = require('assert');
const { Machine } = require('../tools/toyvm/dos');
const { LiveRun, bindKeyboard } = require('../tools/toyvm/live');
const machine = new Machine(new Uint8Array(1024 * 1024), { autoKey: false });
const run = new LiveRun({ canvas: {}, files: {}, exe: 'test.com' });
run.machine = machine;
const down = { key: 'ArrowDown', code: 'ArrowDown' };
run.keyDown(down);
assert.deepStrictEqual(machine.kbQueue, [0xE0, 0x50], 'held interval must contain no break');
run.keyDown(down);
assert.strictEqual(machine.kbQueue.length, 2, 'duplicate down ignored');
run.keyDown({ ...down, repeat: true });
assert.deepStrictEqual(machine.kbQueue, [0xE0, 0x50, 0xE0, 0x50]);
run.keyUp(down);
assert.deepStrictEqual(machine.kbQueue.slice(-2), [0xE0, 0xD0]);
assert.strictEqual(machine.keys.length, 2, 'release creates no BIOS keystroke');
assert.strictEqual(machine.mem[0x41C], 0x22, 'BDA mirrors both makes');
run.keyUp(down);
assert.strictEqual(machine.kbQueue.length, 6);
run.key({ key: 'Enter' });
assert.deepStrictEqual(machine.kbQueue.slice(-2), [0x1C, 0x9C]);
assert.deepStrictEqual(machine.keys.at(-1), { ah: 0x1C, al: 13 });
run.keyDown({ key: 'Shift', code: 'ShiftRight' });
run.keyUp({ key: 'Shift', code: 'ShiftRight' });
assert.deepStrictEqual(machine.kbQueue.slice(-2), [0x36, 0xB6]);
assert.strictEqual(machine.keys.length, 3, 'modifier is not a BIOS character');
for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete']) {
 run.keyDown({ key, code: key }); run.keyUp({ key, code: key });
 assert.strictEqual(machine.kbQueue.at(-2), 0xE0);
}
// Identical semantic keys can come from different physical positions.
for (const [key, code, bytes] of [
  ['2', 'Numpad2', [0x50, 0xD0]],
  ['ArrowDown', 'Numpad2', [0x50, 0xD0]],
  ['End', 'Numpad1', [0x4F, 0xCF]],
  ['End', 'End', [0xE0, 0x4F, 0xE0, 0xCF]],
  ['Enter', 'NumpadEnter', [0xE0, 0x1C, 0xE0, 0x9C]],
  ['/', 'NumpadDivide', [0xE0, 0x35, 0xE0, 0xB5]],
  ['Control', 'ControlRight', [0xE0, 0x1D, 0xE0, 0x9D]],
  ['!', 'Digit1', [0x02, 0x82]],
]) {
  const start = machine.kbQueue.length;
  run.keyDown({ key, code });
  // NumLock/Shift may change the semantic key while this position is held.
  run.keyUp({ key: 'changed', code });
  assert.deepStrictEqual(machine.kbQueue.slice(start), bytes, `${key}/${code}`);
}
// Drive the real IRQ/port and BIOS consumers, not a replacement input model.
const hardware = new Machine(new Uint8Array(1024 * 1024), { autoKey: false });
// Synthetic guest-installed INT9 vector in this isolated unit machine.
hardware.mem[9 * 4 + 2] = 0x00; hardware.mem[9 * 4 + 3] = 0x10;
hardware.keyDown(0x50, 0, true);
assert.strictEqual(hardware.keyboardIrq(), 9);
assert.strictEqual(hardware.portIn_(0x60, 1), 0xE0);
assert.strictEqual(hardware.keyboardIrq(), 9);
assert.strictEqual(hardware.portIn_(0x60, 1), 0x50);
assert.strictEqual(hardware.keyboardIrq(), 0, 'held interval has no release IRQ');
hardware.keyUp(0x50, true);
assert.strictEqual(hardware.keyboardIrq(), 9);
assert.strictEqual(hardware.portIn_(0x60, 1), 0xE0);
assert.strictEqual(hardware.keyboardIrq(), 9);
assert.strictEqual(hardware.portIn_(0x60, 1), 0xD0);
let ax = 0, zf = null;
const registers = { set(name, value) { assert.strictEqual(name, 'ax'); ax = value; }, setResultZf(value) { zf = value; } };
hardware.int16(1, registers); assert.strictEqual(zf, false); assert.strictEqual(ax, 0x5000);
hardware.int16(0, registers); assert.strictEqual(ax, 0x5000);
hardware.int16(1, registers); assert.strictEqual(zf, true, 'release must not create BIOS input');
assert.strictEqual(hardware.mem[0x41C], 0x1E, 'BIOS consumption clears BDA mirror');
const blocked = new LiveRun({ canvas: {}, files: {}, exe: 'test.com' });
blocked.machine = hardware;
hardware.blockedOnKey = true;
blocked.keyDown({ key: 'Shift', code: 'ShiftLeft' });
assert.strictEqual(hardware.blockedOnKey, true, 'a modifier alone cannot satisfy a BIOS wait');
blocked.keyUp({ key: 'Shift', code: 'ShiftLeft' });
const canvas = new EventTarget(), win = new EventTarget(), doc = new EventTarget();
const unbind = bindKeyboard(canvas, () => run, win, doc);
function event(type, properties = {}) { const e = new Event(type, { cancelable: true }); Object.assign(e, properties); return e; }
canvas.dispatchEvent(event('keydown', down));
canvas.dispatchEvent(event('blur'));
assert.strictEqual(machine.heldKeys.size, 0);
assert.strictEqual(machine.kbQueue.at(-1), 0xD0);
canvas.dispatchEvent(event('keydown', { key: 'a', code: 'KeyA' }));
win.dispatchEvent(event('blur'));
assert.strictEqual(machine.kbQueue.at(-1), 0x9E);
canvas.dispatchEvent(event('keydown', down)); doc.hidden = true; doc.dispatchEvent(event('visibilitychange'));
assert.strictEqual(machine.heldKeys.size, 0);
canvas.dispatchEvent(event('keydown', down)); run.stop();
assert.strictEqual(machine.heldKeys.size, 0);
assert.strictEqual(machine.kbQueue.at(-1), 0xD0);
const stoppedLength = machine.kbQueue.length; run.keyDown(down);
assert.strictEqual(machine.kbQueue.length, stoppedLength, 'stopped run accepts no more input');
unbind();
console.log('PASS held interval/release/repeat/tap/BIOS/navigation/modifier/focus/visibility/stop');
