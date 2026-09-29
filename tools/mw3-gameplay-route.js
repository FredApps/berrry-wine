'use strict';

// Fresh browser context: create a pilot, accept Instant Action, then deploy.
// Drive the same relative-input entry points as pointer lock, without needing
// a trusted browser gesture. Keep stage images so route failures are visible.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PNG } = require('pngjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function mw3GameplayRoute(page, output) {
  const shot = async name => {
    const png = await page.screenshot({ path: path.join(output, `route-${name}.png`) });
    return png;
  };
  const click = async (x, y) => page.evaluate(async (x, y) => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const r = sharedRenderer;
    const t = r._exclusiveTransform;
    const move = (dx, dy) => r.handleRelativeMouseMove(dx * t.dstW / t.srcW, dy * t.dstH / t.srcH);
    const button = down => {
      r._mouseButtonsMask = down ? 1 : 0;
      r._queueDirectInputMouseButton(r._pointerInputMemory || r.wasmMemory, 1, down);
      r._signalDirectInputDevice(2);
    };
    // MW3 clamps its own cursor to a nine-pixel inset and applies sensitivity.
    move(-2000, -2000); await wait(250);
    move((x - 9) / 1.27, (y - 9) / 1.27); await wait(300);
    button(true); await wait(200); button(false); await wait(1500);
  }, x, y);
  const waitImage = async (name, predicate) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      // Read just the emulator canvas: toolbar/log colours cannot satisfy this.
      const canvas = await page.$('#screen');
      const bytes = await canvas.screenshot();
      const png = PNG.sync.read(Buffer.from(bytes));
      let green = 0, orange = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
        if (g > 60 && g > r * 1.6 && g > b * 1.4) green++;
        if (r > 100 && r > g * 1.35 && g > b * 1.2) orange++;
      }
      const pixels = png.width * png.height;
      const d3d = await page.evaluate(() => runningApps[0].wine.guestWorker.d3dStats);
      const stats = { green: green / pixels, orange: orange / pixels, d3d };
      if (predicate(stats)) {
        fs.writeFileSync(path.join(output, `route-${name}.json`), JSON.stringify(stats, null, 2));
        await shot(name);
        return;
      }
      await pause(1000);
    }
    await shot(`${name}-timeout`);
    assert.fail(`MW3 did not reach ${name}; inspect route captures`);
  };
  await shot('menu');
  await click(65, 210);
  await shot('pilot');
  await page.evaluate(async () => {
    for (const code of [65, 67, 69]) {
      sharedRenderer.handleKeyDown(code);
      await new Promise(resolve => setTimeout(resolve, 100));
      sharedRenderer.handleKeyUp(code);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
  await click(423, 320);
  await shot('instant-action');
  await click(423, 320);
  await waitImage('operation-map', s => s.green > 0.35);
  // The map is drawn before its deployment icon accepts input.
  await pause(10000);
  const before = await page.evaluate(() => runningApps[0].wine.guestWorker.d3dStats.triangles);
  await click(576, 432);
  await waitImage('cockpit', s => s.orange > 0.15 && s.green < 0.2 && s.d3d.triangles - before > 20000);
  console.log('Verified MW3 cockpit: sky colours and advancing 3D geometry');
};
