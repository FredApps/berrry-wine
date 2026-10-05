#!/usr/bin/env node
'use strict';

// Pawn 3 asks DirectInput for IID_IDirectInputDevice7A and has no fallback if
// it is refused: CreateDeviceEx failing made it put up "This program requires
// DirectX 9 or later!" and quit, which is a misleading message -- its D3D9
// probe (three GetAdapterModeCount calls summed) passes. This drives a real
// move to prove the v7 face is complete rather than merely accepted: a v2
// vtable handed out under a v7 identity would put slots 27/28 on whatever
// interface's thunks follow ours.
//
// Every pixel assertion below reads the COMPOSITED DESKTOP inside the "Pawn 3"
// window's client rectangle, never the D3D9 surface. Pawn points its windowed
// device at a screen-sized STATIC child of that window, and for a while the
// surface held a perfect board while the window showed empty grey: a capture
// of the surface passes that state, a capture of the screen cannot.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const exe = path.join(root, 'binaries/wep32-community/Pawn/Pawn.exe');
if (!fs.existsSync(exe)) {
  console.log('SKIP Pawn is not present');
  process.exit(0);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pawn-dinput7-'));

// The board is the 352x352 client area of the "Pawn 3" window at 350,100, so
// a square is 44px and its centre is screen (350 + 44*file + 22, 123 + 44*rank
// + 22). Pawn 3 moves on a drag, not on two clicks: a press and release with
// no motion between them selects nothing. This drags the e-pawn up two ranks.
const input = [
  '800:mousemove:552:409',
  '1000:mousedown:552:409',
  '1200:mousemove:552:365',
  '1400:mousemove:552:321',
  '1600:mouseup:552:321',
  // Move the cursor off the board so a hover highlight cannot be mistaken for
  // the engine's move highlight below.
  '1800:mousemove:900:600',
].join(',');

// Both D3D9 backends. The WebGL one needs a GL provider: without one
// CreateDevice fails with "D3D9 requires a GPU window" and the guest later
// traps. The software one presents its FIRST frame from the WM_SIZE that
// SetWindowPos sends, i.e. inside a recursive synchronous SendMessage, where a
// parked Present used to abandon the window procedure and leave Pawn calling
// through a NULL HDC. Its worker also retires frames more slowly per batch, so
// at 9000 batches the engine's reply is still animating.
const ARMS = [
  { name: 'webgl', args: ['--headless-gl'], batches: 9000 },
  { name: 'software', args: ['--d3d9-renderer=software'], batches: 20000 },
];
const only = process.env.PAWN_BACKEND;

for (const arm of ARMS) {
  if (only && only !== arm.name) continue;
  const shot = path.join(temp, `after-move-${arm.name}.png`);
  const run = spawnSync(process.execPath, [
    'test/run.js',
    '--app=pawn',
    '--no-build',
    ...arm.args,
    '--screen=1024x768',
    `--max-batches=${arm.batches}`,
    '--max-seconds=90',
    '--quiet-api',
    '--no-close',
    `--input=${input}`,
    `--png=${shot}`,
    // The COMPOSITED desktop, not the raw D3D9 surface. --png prefers a DX
    // surface, and that surface held a perfect board for a long time while the
    // window's client area was empty -- Pawn presents to a screen-sized STATIC
    // CHILD of its main window, and nothing composited that child's frame. A
    // capture of the surface cannot tell the two apart; this one can.
    '--png-canvas',
  ], { cwd: root, encoding: 'utf8', timeout: 150000, maxBuffer: 16 * 1024 * 1024 });

  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.strictEqual(run.error, undefined, run.error && run.error.message);
  assert.strictEqual(run.status, 0, output.slice(-4000));
  assert(!output.includes('requires DirectX 9'),
    `Pawn still refuses to start:\n${output.slice(-4000)}`);
  assert(!output.includes('D3D9 requires a GPU window'), output.slice(-4000));
  assert(!output.includes('*** CRASH'), output.slice(-4000));
  assert(!output.includes('UNIMPLEMENTED API'), output.slice(-4000));
  assert(fs.existsSync(shot), `no frame was captured\n${output.slice(-4000)}`);

  const png = PNG.sync.read(fs.readFileSync(shot));
  const count = (x0, y0, x1, y1, predicate) => {
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        if (predicate(png.data[i], png.data[i + 1], png.data[i + 2])) n++;
      }
    }
    return n;
  };

  // The CLIENT AREA of the "Pawn 3" window, in screen coordinates: the window
  // is at 350,100 and its client starts at 354,142 and is 352x352. Every count
  // below is inside that rectangle, so a frame that exists only inside the D3D9
  // surface -- which is what this test used to read -- scores zero here.
  const CX = 354, CY = 142, CW = 352, CH = 352;
  const board = (predicate) => count(CX, CY, CX + CW, CY + CH, predicate);

  // The board itself: white pieces, black pieces, and wood squares between them.
  const whitePieces = board((r, g, b) => r > 200 && g > 200 && b > 180);
  const blackPieces = board((r, g, b) => r < 60 && g < 60 && b < 40);
  const wood = board((r, g, b) => r > 90 && r > b * 1.4 && g > b);
  // COLOR_BTNFACE. An empty client is ~124k of it; a drawn board has none.
  const grey = board((r, g, b) => r === 192 && g === 192 && b === 192);
  assert(whitePieces > 2000, `white pieces are missing from the window (${whitePieces} px)`);
  assert(blackPieces > 2000, `black pieces are missing from the window (${blackPieces} px)`);
  assert(wood > 60000, `the board never reached the window (${wood} px wood, ${grey} px grey)`);
  assert(grey < 1000, `the client area is still empty grey (${grey} px)`);

  // Pawn 3 outlines the engine's own last move in yellow. Those pixels exist
  // only after our drag was accepted as a legal move AND the engine replied, so
  // this one predicate covers the whole round trip -- input routing, the v7
  // device, and the engine actually running.
  const highlight = board((r, g, b) => r > 180 && g > 180 && b < 100);
  assert(highlight > 100,
    `the engine did not answer the move (${highlight} highlight px)\n${output.slice(-2000)}`);

  console.log(`PASS [${arm.name}] Pawn creates its IDirectInputDevice7 and plays a move ` +
    `(${whitePieces} white, ${blackPieces} black, ${highlight} highlight px)`);
}
