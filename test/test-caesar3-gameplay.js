#!/usr/bin/env node
// Caesar III all the way into a running city, including a real governor name.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { startControlSession } = require('./control-session');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'test/binaries/candidates/caesar-3-demo/installed/c3.exe');
const ANALYZE_ONLY = process.argv[2];

function stats(png, x0, y0, x1, y1) {
  let green = 0;
  let dark = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (g > r + 8 && g > b + 8) green++;
      if (r < 90 && g < 90 && b < 90) dark++;
      total++;
    }
  }
  return { green: green / total, dark: dark / total };
}

function verifyCity(filename) {
  const png = PNG.sync.read(fs.readFileSync(filename));
  assert.strictEqual(png.width, 800, 'Caesar III must present its 800x600 mode');
  assert.strictEqual(png.height, 600);
  const map = stats(png, 0, 30, 590, 590);
  const sidebar = stats(png, 610, 60, 790, 470);
  const topBar = stats(png, 0, 2, 800, 16);
  console.log(`map green ${(map.green * 100).toFixed(1)}%  ` +
    `sidebar green ${(sidebar.green * 100).toFixed(1)}%  ` +
    `top bar dark ${(topBar.dark * 100).toFixed(1)}%`);
  assert(map.green > 0.35,
    `the city map should be mostly green terrain, saw ${(map.green * 100).toFixed(1)}%`);
  assert(sidebar.green < 0.20,
    `the stone control panel should not be terrain, saw ${(sidebar.green * 100).toFixed(1)}% green`);
  assert(map.green - sidebar.green > 0.3,
    'the city map and control panel should be visually distinct');
}

async function main() {
  if (ANALYZE_ONLY) {
    verifyCity(ANALYZE_ONLY);
    console.log('PASS  Caesar III capture is a playable city view');
    return;
  }
  if (!fs.existsSync(EXE)) {
    console.log('SKIP  Caesar III installer-produced demo payload is missing');
    return;
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-caesar3-gameplay-'));
  // Hooks for tools/uop-game-ab.js (game `c3`): every capture into one
  // directory, extra run.js flags per arm, CAESAR3_CITY_BATCHES more batches
  // of the city simulating after the check (its RLE sprite blit and ladder are
  // what the A/B is about), and the run.js output kept in CAESAR3_LOG.
  const shotDir = process.env.CAESAR3_SCREENSHOT_DIR || '';
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const namePath = process.env.CAESAR3_NAME_SCREENSHOT || path.join(shotDir || temp, 'name.png');
  const cityPath = process.env.CAESAR3_SCREENSHOT || path.join(shotDir || temp, 'city.png');
  const cityBatches = parseInt(process.env.CAESAR3_CITY_BATCHES || '0', 10) || 0;
  const extraArgs = (process.env.CAESAR3_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const maxSeconds = process.env.CAESAR3_MAX_SECONDS || '90';
  const args = [
    'test/run.js', '--app=caesar3_demo', '--screen=800x600', '--batch-size=50000',
    '--control-stdin', '--frozen', `--max-seconds=${maxSeconds}`, '--max-batches=1000000',
    '--quiet-api', '--quiet-blocks', '--no-close', '--repaint-every=1000000',
    ...extraArgs,
  ];
  if (fs.existsSync(path.join(ROOT, 'build/wine-assembly.wasm'))) args.push('--no-build');
  const session = startControlSession(args, { cwd: ROOT, idPrefix: 'c3-' });
  const { send, step } = session;
  async function pressAt(x, y, moveGap = 40, holdGap = 40) {
    await send(`mousemove:${x}:${y}`);
    await step(moveGap);
    await send(`mousedown:${x}:${y}`);
    await step(holdGap);
    await send(`mouseup:${x}:${y}`);
  }
  async function typeText(text) {
    for (const ch of text) {
      const vk = ch.toUpperCase().charCodeAt(0);
      await send(`keydown:${vk}`);
      await send(`keypress:${ch.charCodeAt(0)}`);
      await send(`keyup:${vk}`);
      await step(10);
    }
  }
  const readGovernorName = () => send({
    action: 'eval',
    code: `(() => { const m=new Uint8Array(memory.buffer), p=g2w(0x57eb3c); let s=''; for(let i=0;i<32&&m[p+i];i++)s+=String.fromCharCode(m[p+i]); return s; })()`,
  });

  try {
    await send({ action: 'ping' });
    await step(700);

    // Getting to the name screen is a retry loop, not a batch schedule. Two
    // states of the main menu swallow a click on "Start new game" and neither
    // is visible in a capture as anything but a blank plate: the menu is drawn
    // as a white panel until the app has finished loading (a click at batch 600
    // does nothing at all), and an idle timer swaps in the attract title
    // (title.565) around batch 1000, where the same click only dismisses the
    // title. A fixed batch number therefore encodes today's load speed, which
    // is what made this test start failing with an empty name buffer.
    //
    // The oracle is the buffer itself: keys only reach it on the name screen,
    // so each attempt clicks a neutral spot (dismisses an attract frame,
    // harmless on the menu), clicks the button, and types. If 'Codex' arrives
    // we are there; if nothing arrives the click was swallowed, so try again.
    let reached = false;
    let lastName = null;
    for (let attempt = 0; attempt < 8 && !reached; attempt++) {
      await pressAt(400, 500, 40, 40); // neutral: below every menu plate
      await step(150);
      await pressAt(400, 172);         // Start new game
      await step(300);
      lastName = await readGovernorName();
      if (lastName !== '') continue;   // not the empty name screen
      await typeText('Codex');
      lastName = await readGovernorName();
      reached = lastName === 'Codex';
    }
    assert(reached,
      'typing a short name must not retain a suffix from the default text: ' +
      `never reached an empty name buffer accepting keys (last read ${JSON.stringify(lastName)})`);
    await send(`png:${namePath}`);

    await pressAt(548, 320);         // Continue; now batch 1580
    await step(1020);
    await pressAt(613, 502);         // To the city; now batch 2680
    await step(720);
    await send(`png:${cityPath}`);

    verifyCity(cityPath);
    assert(session.output().includes('patched Caesar III new-career name buffer starts empty'),
      `Caesar III compatibility patch was not reported\n${session.output().slice(-5000)}`);
    assert(!/UNIMPLEMENTED API:|\*\*\* CRASH|RuntimeError|LinkError/i.test(session.output()),
      `Caesar III hit a compatibility failure\n${session.output().slice(-5000)}`);

    if (cityBatches > 0) {
      await step(cityBatches);
      await send(`png:${path.join(shotDir || temp, 'city-later.png')}`);
    }
    const code = await session.quit();
    if (process.env.CAESAR3_LOG) fs.writeFileSync(process.env.CAESAR3_LOG, session.output());
    assert.strictEqual(code, 0,
      `Caesar III CLI exited ${code}\n${session.output().slice(-5000)}`);
    console.log(`PASS  Caesar III typed-name screenshot: ${namePath}`);
    console.log(`PASS  Caesar III playable-city screenshot: ${cityPath}`);
  } catch (error) {
    await session.quit({ ignoreReplyError: true });
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`FAIL Caesar III gameplay: ${error.stack || error.message}`);
  process.exit(1);
});
