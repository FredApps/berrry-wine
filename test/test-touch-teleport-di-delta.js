#!/usr/bin/env node
'use strict';

// A touchscreen tap must not look like mouse travel to DirectInput.
//
// renderer-input synthesises DIMOUSESTATE relative deltas from the difference
// between successive ABSOLUTE pointer positions, which is right for a mouse
// and a lie for a finger: each tap arrives as one jump from wherever the
// previous tap was, and nothing physically moved across that gap. Games that
// keep their own cursor believe the lie. Marbles (Plus! 98) polls
// GetDeviceState once per WM_MOUSEMOVE and never reads the Win32 cursor, so
// tap-sized deltas walked its pointer off the finger, parked it on the mode
// menu's bottom-right item -- QUIT -- and every later tap anywhere on the
// screen then called ExitProcess. That was the "clicking in Marbles just
// quits" report.
//
// So: `{ teleport: true }` moves the reference point and emits no delta, and
// the touch bridge publishes tap positions that way. Ordinary motion is
// unchanged -- both halves are asserted here, because a fix that silenced
// DirectInput for real movement would break every relative-mouse game.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startControlSession } = require('./control-session');
const REGIONS = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(__dirname, 'binaries', 'xp', 'winmine.exe');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  winmine.exe not found at ' + EXE);
  process.exit(0);
}

const BASE = (REGIONS.BASE || REGIONS).DI_MOUSE_INPUT_STATE;
const DI_BASE = typeof BASE === 'object' ? BASE.base : BASE;
assert(Number.isFinite(DI_BASE), 'region map should name DI_MOUSE_INPUT_STATE');

// Read (and clear) the accumulated DirectInput delta the way the guest does.
const READ_DELTA = `(() => {
  const memory = renderer.wasmMemory;
  const buffer = memory.buffer || memory;
  const words = new Int32Array(buffer);
  const index = ${DI_BASE} >>> 2;
  const value = [words[index], words[index + 1]];
  words[index] = 0; words[index + 1] = 0;
  return value;
})()`;

const session = startControlSession([
  'test/run.js', '--exe=' + EXE, '--control-stdin', '--frozen',
  '--max-seconds=30', '--quiet-api', '--quiet-blocks', '--no-build',
], { cwd: ROOT, idPrefix: 'tele-' });

(async () => {
  try {
    // Establish the reference point, then move: a mouse travelling 100x50
    // must still reach DirectInput as 100x50.
    await session.send({ action: 'eval', code: 'renderer.handleMouseMove(100, 100); true' });
    await session.send({ action: 'eval', code: READ_DELTA });
    await session.send({ action: 'eval', code: 'renderer.handleMouseMove(200, 150); true' });
    assert.deepStrictEqual(await session.send({ action: 'eval', code: READ_DELTA }),
      [100, 50], 'ordinary pointer motion must still reach DirectInput');

    // The same jump marked as a teleport must move nothing.
    await session.send({ action: 'eval', code: 'renderer.handleMouseMove(300, 200, { teleport: true }); true' });
    assert.deepStrictEqual(await session.send({ action: 'eval', code: READ_DELTA }),
      [0, 0], 'a teleported pointer publish must not reach DirectInput as motion');

    // ...and it must still have moved the reference, so the NEXT real move is
    // measured from where the finger is rather than from before the jump.
    await session.send({ action: 'eval', code: 'renderer.handleMouseMove(310, 205); true' });
    assert.deepStrictEqual(await session.send({ action: 'eval', code: READ_DELTA }),
      [10, 5], 'a teleport must still reseat the DirectInput reference point');

    // The Win32 cursor is published either way: the tap still hit-tests.
    assert.deepStrictEqual(await session.send({
      action: 'eval', code: '[renderer._mouseX, renderer._mouseY]',
    }), [310, 205], 'a teleported publish must still move the Win32 cursor');

    const code = await session.quit();
    assert.strictEqual(code, 0, session.output().slice(-3000));
    console.log('PASS  a teleported pointer publish reseats DirectInput without faking motion');
  } catch (error) {
    await session.quit({ ignoreReplyError: true });
    throw error;
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
