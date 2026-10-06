#!/usr/bin/env node
// Bring-your-own-ISO, end to end, with a retail disc that installs itself:
// Myth: The Fallen Lords (Bungie, 1997). Local-only -- the ISO is the user's
// own media (candidate myth-the-fallen-lords, fetched by
// tools/fetch-candidate-corpus.js) and is never part of the repository.
//
//   1. drop the ISO through the page's real <input type=file>; the insert
//      dialog has to find D:\Setup.exe among the disc's programs
//   2. "Insert and keep" (OPFS) + run D:\Setup.exe; drive the MindVision VISE
//      installer by keyboard and answer its DirectX question with No
//   3. Setup creates its Start Menu group through Program Manager DDE; that
//      .lnk has to come back as a KEPT desktop icon for the installed exe
//   4. double-click it: the installed game runs from C: with the ISO as D:
//      (DRIVE_CDROM, label MYTH_TFL), reaches Crow's Bridge, and answers input
//      (holding A turns the camera) with audible in-level DirectSound
//
// Each stage failed once on its own: no PROGMAN execute => no icon
// (e7c970ef); in-level silence from a sparse DirectSound ring (df6de866);
// "no network modules" from a LoadLibrary inside DllMain (ba4a740d).
// Takes ~4 minutes. Timing is real browser time, so the waits are generous.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startStaticServer } = require('./static-server');
const { diffPng } = require('../tools/png-diff');

const ROOT = path.join(__dirname, '..');
const ISO = path.join(ROOT, 'test', 'binaries', 'candidates', 'myth-the-fallen-lords', 'sources', 'myth-tfl.iso');
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const OUT = path.join(ROOT, 'test', 'output', 'myth-byo-iso');
const wait = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(ISO)) {
  console.log('SKIP  Myth retail ISO not present (candidate myth-the-fallen-lords)');
  process.exit(0);
}
if (!CHROME) {
  console.log('SKIP  Chrome not found');
  process.exit(0);
}

// Same inversion tools/web-input-probe.js uses: guest pixels through the
// exclusive-fullscreen viewport to page coordinates.
const toPage = (page, gx, gy) => page.evaluate(([x, y]) => {
  const c = document.getElementById('screen');
  const r = c.getBoundingClientRect();
  const v = typeof sharedRenderer !== 'undefined' && sharedRenderer &&
    sharedRenderer._exclusivePresentationViewport;
  let cx = x + 0.5;
  let cy = y + 0.5;
  if (v && v.nativeW > 0 && v.nativeH > 0 && v.outputW > 0 && v.outputH > 0) {
    cx = (v.dstX + (x + 0.5 - v.nativeX) * v.dstW / v.nativeW) * c.width / v.outputW;
    cy = (v.dstY + (y + 0.5 - v.nativeY) * v.dstH / v.nativeH) * c.height / v.outputH;
  }
  return { x: r.left + cx * (r.width / c.width), y: r.top + cy * (r.height / c.height) };
}, [gx, gy]);

// Peak of the PCM the guest hands DirectSound plus the master output level,
// sampled every 50 ms for `ms`.
const audioWindow = (page, ms) => page.evaluate(async (duration) => {
  const app = runningApps.find(a => a && a.wine && a.wine.running);
  const vm = app && app.wine._sharedAudio && app.wine._sharedAudio.voices;
  if (!vm || typeof vm.playRing !== 'function') return { error: 'no voice manager' };
  const st = { plays: 0, pcmPeak: 0, loud: 0, samples: 0 };
  const play = vm.playRing;
  vm.playRing = function (id, ptr, len) {
    st.plays++;
    try {
      const dv = new DataView(app.wine.memory.buffer);
      for (let i = 0; i + 1 < Math.min(len, 65536); i += 2) {
        st.pcmPeak = Math.max(st.pcmPeak, Math.abs(dv.getInt16(ptr + i, true)) / 32768);
      }
    } catch (_) {}
    return play.apply(this, arguments);
  };
  const an = vm._ac && vm._ac._wineMasterAnalyser;
  const buf = new Float32Array(an ? an.fftSize : 256);
  for (let t = 0; t < duration; t += 50) {
    if (an) {
      an.getFloatTimeDomainData(buf);
      let p = 0;
      for (const x of buf) p = Math.max(p, Math.abs(x));
      st.samples++;
      if (p > 0.001) st.loud++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  vm.playRing = play;
  return st;
}, ms);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = require('puppeteer');
  const server = await startStaticServer({ root: ROOT });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--no-first-run'] });
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!window.wineMedia && typeof launchApp === 'function',
      { timeout: 90000 });

    // ---- 1. drop the disc ------------------------------------------------
    const input = await page.evaluateHandle(() => window.wineMedia._fileInput);
    await input.asElement().uploadFile(ISO);
    await page.evaluate(() =>
      window.wineMedia._fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForFunction(() => !!document.querySelector('.wa-media-modal'), { timeout: 120000 });
    const dialog = await page.evaluate(() => {
      const m = document.querySelector('.wa-media-modal');
      return { body: m.querySelector('.wa-media-body').textContent,
        options: [...m.querySelectorAll('select option')].map(o => o.value),
        keepEnabled: !m.querySelectorAll('input[type=radio]')[1].disabled };
    });
    assert.match(dialog.body, /MYTH_TFL/, 'the dialog names the disc label');
    assert.ok(dialog.options.includes('D:\\Setup.exe'), `Setup.exe is offered: ${dialog.options}`);
    assert.ok(dialog.keepEnabled, 'Chrome has OPFS, so "keep" is available');
    console.log('PASS  ISO import dialog: MYTH_TFL, Setup.exe offered, keep available');

    // ---- 2. install into the OPFS-backed C: --------------------------------
    await page.evaluate(() => {
      const m = document.querySelector('.wa-media-modal');
      const sel = m.querySelector('select');
      sel.value = 'D:\\Setup.exe';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      m.querySelectorAll('input[type=radio]')[1].click();
      const launch = m.querySelector('input[type=checkbox]');
      if (!launch.checked) launch.click();
      [...m.querySelectorAll('button')].find(b => b.textContent === 'OK').click();
    });
    await page.waitForFunction(() => runningApps.some(a => a && a.wine && a.wine.running),
      { timeout: 240000 });
    const canvas = await page.$('#screen');
    const press = async (key, holdMs = 150) => {
      await canvas.focus().catch(() => {});
      await page.keyboard.down(key);
      await wait(holdMs);
      await page.keyboard.up(key);
    };
    await wait(15000);
    for (let i = 0; i < 6; i++) { await press('Enter'); await wait(4000); }
    let asked = false;
    for (let i = 0; i < 30 && !asked; i++) {
      await wait(5000);
      asked = await page.evaluate(() =>
        /Install DirectX 5\.0\?/.test((document.getElementById('log') || {}).textContent || '') ||
        [...document.querySelectorAll('.taskbar-button, button')].some(b => /Install DirectX/.test(b.textContent)));
    }
    await shot(page, '01-directx-question');
    assert.ok(asked, 'the installer finishes copying and asks about DirectX');
    await press('Tab'); await wait(300); await press('Enter');   // No
    await wait(8000);
    await press('Enter');                                         // Close
    let icon = null;
    for (let i = 0; i < 24 && !icon; i++) {
      await wait(5000);
      icon = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.desktop-icon[data-media-badge]')]
          .find(i => /myth the fallen lords/i.test(i.textContent || ''));
        return el ? { appId: el.dataset.app, badge: el.dataset.mediaBadge } : null;
      });
    }
    await shot(page, '02-desktop-icon');
    assert.ok(icon, 'Setup\'s Start Menu shortcut becomes a desktop icon');
    assert.strictEqual(icon.badge, 'kept', 'installed from kept media, the icon is kept');
    assert.match(icon.appId, /myth_tfl\\myth_tfl\.exe$/i, `the icon targets the installed exe: ${icon.appId}`);
    console.log('PASS  VISE Setup ran from D: and its Program Manager shortcut became a kept icon');

    // ---- 3. play the installed game with the disc as D: -------------------
    const handle = await page.evaluateHandle(id =>
      document.querySelector(`.desktop-icon[data-app="${CSS.escape(id)}"]`), icon.appId);
    await handle.asElement().evaluate(el => el.scrollIntoView({ block: 'center' }));
    await wait(500);
    const box = await handle.asElement().boundingBox();
    // The desktop's open gesture: two clicks within 500 ms.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await wait(150);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => runningApps.some(a => a && a.wine && a.wine.running),
      { timeout: 60000 });
    const drives = await page.evaluate(() => {
      const app = runningApps.find(a => a && a.wine && a.wine.running);
      const vfs = app.wine._helpCtx.vfs;
      return { label: vfs.volumeLabels && vfs.volumeLabels.get('d'),
        type: vfs.driveTypes && vfs.driveTypes.get('d'),
        disc: vfs.files.has('d:\\tags\\artsound.gor'),
        exe: vfs.files.has('c:\\program files\\myth_tfl\\myth_tfl.exe') };
    });
    assert.deepStrictEqual(drives, { label: 'MYTH_TFL', type: 5, disc: true, exe: true },
      'the installed game runs from C: with the ISO as CD-ROM D:');
    const hold = async (gx, gy, ms = 300) => {
      const p = await toPage(page, gx, gy);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await wait(ms);
      await page.mouse.up();
    };
    await wait(25000);
    await hold(320, 240);             // skip the intro movie
    await wait(14000);
    await hold(310, 258);             // New Game
    await wait(20000);
    await hold(320, 400);             // past the briefing
    await wait(38000);
    await shot(page, '03-in-level');
    const before = path.join(OUT, '03-in-level.png');
    await page.keyboard.down('KeyA'); await wait(1500); await page.keyboard.up('KeyA'); await wait(500);
    await shot(page, '04-turned-left');
    const turned = diffPng(before, path.join(OUT, '04-turned-left.png'));
    const changedPct = turned.share * 100;
    assert.ok(changedPct > 20, `holding A turns the camera (changed ${changedPct.toFixed(1)}% of the page)`);
    const audio = await audioWindow(page, 15000);
    assert.ok(audio.plays > 0 && audio.pcmPeak > 0.01 && audio.loud > 0,
      `in-level DirectSound is audible: ${JSON.stringify(audio)}`);
    console.log(`PASS  installed Myth plays with the ISO as D: (camera turn ${changedPct.toFixed(0)}%, ` +
      `${audio.plays} plays, PCM peak ${audio.pcmPeak.toFixed(3)}, output ${audio.loud}/${audio.samples})`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
