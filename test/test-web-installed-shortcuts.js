#!/usr/bin/env node
// Installed-game icons from kept media survive a reload -- and only then.
//
// WHY: an installer run from kept (OPFS) media leaves C:\WINDOWS\Desktop\*.lnk
// and writes the game into that media's durable C:\ journal. The user asked
// that those icons come back after a reload when the files were saved. The
// opposite matters as much: an icon must not come back for an install that
// was never saved or has since been deleted, must not appear twice, and must
// go away with its media.
//
// This drives the real page: a kept media row in the real MediaLibrary, a real
// OPFS journal (OverlayStore.opfsStore), and the real shell path that turns an
// exited installer's desktop shortcuts into icons
// (browserShell.unregisterRunningApp -> publishGuestShortcuts -> media UI).
// The installer itself is stood in for by a finished guest filesystem: running
// a real InstallShield here would cost minutes and prove nothing more about
// the save/restore rules. Launching the restored icon is checked as the entry
// it would launch (installed exe, kept media, its journal), not by booting it.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer, closeServer } = require('./static-server');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME ||
  ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find(p => fs.existsSync(p));
if (!CHROME) {
  console.log('SKIP  Chrome not found for installed-shortcuts test');
  process.exit(0);
}

// A minimal ANSI .lnk: header, then RelativePath + WorkingDir + Name strings.
function shellLink(target, workingDir, description) {
  const header = Buffer.alloc(0x4C);
  header.writeUInt32LE(0x4C, 0);
  header.writeUInt32LE(0x00021401, 4);
  header.writeUInt32LE(0x04 | 0x08 | 0x10, 0x14);  // name, relative path, working dir
  const str = s => Buffer.concat([Buffer.from([s.length & 0xff, s.length >> 8]), Buffer.from(s, 'latin1')]);
  return [...Buffer.concat([header, str(description), str(target), str(workingDir)])];
}

async function main() {
  const server = await startStaticServer({ root: ROOT });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--no-first-run'],
  });
  let failures = 0;
  const check = (name, ok, detail) => {
    if (ok) console.log(`PASS  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));
    // No service worker: this test is about the page's own storage.
    await page.evaluateOnNewDocument(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    const open = async () => {
      await page.goto(`${base}/index.html?single-app=0&t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.wineMedia && window.wineShell && window.InstalledShortcuts &&
        document.querySelectorAll('#desktop-icons .desktop-icon').length > 0, { timeout: 60000 });
      // restoreLibrary runs at load; wait until the catalog has been read.
      await page.evaluate(() => window.wineMedia.restoreLibrary && null);
      await new Promise(r => setTimeout(r, 1500));
    };
    await open();

    const lnkGame = shellLink('C:\\GAME\\GAME.EXE', 'C:\\GAME', 'Test Game');
    const lnkGone = shellLink('C:\\GONE\\GONE.EXE', 'C:\\GONE', 'Gone Game');
    const setup = await page.evaluate(async (lnkGame, lnkGone) => {
      const lib = await window.mediaLibrary.MediaLibrary.open();
      const file = new File([new Uint8Array([0x4d, 0x5a, 1, 2])], 'setup.exe');
      const row = await lib.add(file, { kind: 'exe', name: 'setup.exe',
        extra: { exePath: 'c:\\setup.exe', appLabel: 'Setup' } });
      // The installed game is in the kept journal; the "gone" one never was.
      const store = window.OverlayStore.opfsStore(row.id);
      await store.writeBatch([{ path: 'c:\\game\\game.exe', kind: 'file', attrs: 0x20, size: 2,
        data: new Uint8Array([0x4d, 0x5a]) }]);
      // A finished install: the exited process's filesystem, as the shell sees it.
      const norm = p => String(p).toLowerCase().replace(/\//g, '\\');
      const files = new Map([
        ['c:\\windows\\desktop\\test game.lnk', { data: new Uint8Array(lnkGame) }],
        ['c:\\windows\\desktop\\gone game.lnk', { data: new Uint8Array(lnkGone) }],
        ['c:\\game\\game.exe', { data: new Uint8Array([0x4d, 0x5a]) }],
        ['c:\\gone\\gone.exe', { data: new Uint8Array([0x4d, 0x5a]) }],
      ]);
      const vfs = { files, dirs: new Set(), cwd: 'c:\\', _normPath: norm };
      const wine = { processId: 4242, _helpCtx: { vfs }, _keptMediaId: row.id,
        _vfsOverlay: { dirtyPaths: () => [] }, _flushVfsOverlay: async () => null };
      window.wineShell.runningApps.push({ wine, name: 'setup', appIndex: 99 });
      window.wineShell.unregisterRunningApp(wine);
      const id = window.InstalledShortcuts.appIdFor(row.id, 'c:\\game\\game.exe');
      const goneId = window.InstalledShortcuts.appIdFor(row.id, 'c:\\gone\\gone.exe');
      const deadline = performance.now() + 10000;
      for (;;) {
        const fresh = await lib.get(row.id);
        if ((fresh.shortcuts || []).length >= 2 || performance.now() > deadline) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const stored = (await lib.get(row.id)).shortcuts || [];
      const badge = ([...document.querySelectorAll(".desktop-icon")].find(n => n.dataset.app === id) || {}).dataset?.mediaBadge;
      return { rowId: row.id, id, goneId, stored: stored.map(s => s.target), badge };
    }, lnkGame, lnkGone);
    check('an install from kept media saves its shortcuts on the media row',
      setup.stored.includes('c:\\game\\game.exe'), JSON.stringify(setup.stored));
    check('its icon turns into a kept icon once the files are saved', setup.badge === 'kept', setup.badge);

    // An install whose files did not reach the journal stays a session icon.
    const unsaved = await page.evaluate(async rowId => {
      const lib = await window.mediaLibrary.MediaLibrary.open();
      window.wineMedia.addSessionIcon({ appId: 'lnk:' + rowId + ':c:\\unsaved\\u.exe', label: 'Unsaved',
        mediaId: rowId, target: 'c:\\unsaved\\u.exe', cwd: 'c:\\unsaved\\', saved: Promise.resolve(false) });
      await new Promise(r => setTimeout(r, 500));
      return ((await lib.get(rowId)).shortcuts || []).map(s => s.target);
    }, setup.rowId);
    check('an unsaved install is not kept', !unsaved.includes('c:\\unsaved\\u.exe'), JSON.stringify(unsaved));

    // Reload: the saved one comes back once, the never-saved one is pruned.
    await open();
    const after = await page.evaluate(async ({ rowId, id, goneId }) => {
      const lib = await window.mediaLibrary.MediaLibrary.open();
      const nodes = [...document.querySelectorAll(".desktop-icon")].filter(n => n.dataset.app === id);
      const entry = (window.wineApps && window.wineApps.APPS || {})[id];
      return {
        count: nodes.length,
        badge: nodes[0] && nodes[0].dataset.mediaBadge,
        label: nodes[0] && nodes[0].textContent,
        gone: [...document.querySelectorAll(".desktop-icon")].filter(n => n.dataset.app === goneId).length,
        stored: ((await lib.get(rowId)).shortcuts || []).map(s => s.target),
        entry: entry && { exe: entry.exe, badge: entry.badge, mediaId: entry.mediaId,
          dynamic: entry.dynamic, cwd: entry.workingDirectory, mounts: entry.mounts.length },
      };
    }, setup);
    check('after a reload the installed game has exactly one kept icon',
      after.count === 1 && after.badge === 'kept' && /Test Game/.test(after.label), JSON.stringify(after));
    check('a shortcut whose program is not in the saved journal does not come back',
      after.gone === 0 && !after.stored.includes('c:\\gone\\gone.exe'), JSON.stringify(after.stored));
    check('the restored icon launches the installed exe from the kept media and its journal',
      after.entry && after.entry.exe === 'c:\\game\\game.exe' && after.entry.badge === 'kept' &&
      after.entry.mediaId === setup.rowId && after.entry.dynamic === true &&
      after.entry.cwd === 'c:\\game\\' && after.entry.mounts === 1, JSON.stringify(after.entry));

    // Removing the media removes its installed games too, now and after reload.
    await page.evaluate(() => window.wineMedia.showLibrary());
    await page.waitForFunction(() => [...document.querySelectorAll('.wa-media-row button')]
      .some(b => b.textContent === 'Remove'), { timeout: 10000 });
    await page.evaluate(() => [...document.querySelectorAll('.wa-media-row button')]
      .find(b => b.textContent === 'Remove').click());
    await page.waitForFunction(id => ![...document.querySelectorAll(".desktop-icon")].some(n => n.dataset.app === id),
      { timeout: 10000 }, setup.id).catch(() => {});
    const removedNow = await page.evaluate(id => !![...document.querySelectorAll(".desktop-icon")].some(n => n.dataset.app === id), setup.id);
    await open();
    const removedReload = await page.evaluate(id => !![...document.querySelectorAll(".desktop-icon")].some(n => n.dataset.app === id), setup.id);
    check('removing the media removes its installed-game icon, also after reload',
      !removedNow && !removedReload, `now ${removedNow}, after reload ${removedReload}`);
  } finally {
    await browser.close();
    await closeServer(server);
  }
  if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
  console.log('PASS  installed-game icons from kept media survive reload');
}

main().catch(error => { console.error(error); process.exit(1); });
