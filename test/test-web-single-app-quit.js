#!/usr/bin/env node
// Quitting an app on a phone has to give the desktop back.
//
// WHY: in single-app mode the desktop icons are the only launcher on the page
// -- no taskbar, no toolbar, no app dropdown. Three separate classes hide
// them (app-running, exclusive-fullscreen, page-fullscreen), so any one of
// them still set after the last guest stops leaves a blank teal page that
// cannot start anything. The renderer clears exclusive mode on a repaint
// *transition*, and a transition can be missed -- an app that drops out of
// exclusive for a final dialog and exits from there never makes the edge.
//
// So this asserts the end state a visitor cares about, from the worst start:
// both fullscreen classes stuck on, the app stopped, and then a real tap on a
// real icon that has to launch something.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { startStaticServer: startSharedStaticServer } = require('./static-server');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(ROOT, 'test', 'output', 'single-app-quit');
const VIEWPORT = { width: 390, height: 664, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

if (!fs.existsSync(CHROME)) {
  console.log('SKIP  Chrome not found for single-app quit test');
  process.exit(0);
}

function startStaticServer() {
  return startSharedStaticServer({ root: ROOT });
}

const desktopState = () => {
  const icons = document.getElementById('desktop-icons');
  const style = icons ? getComputedStyle(icons) : null;
  const first = document.querySelector('.desktop-icon');
  const rect = first ? first.getBoundingClientRect() : null;
  return {
    display: style ? style.display : 'missing',
    classes: document.body.className,
    iconCount: document.querySelectorAll('.desktop-icon').length,
    // Displayed is not the same as reachable: an icon scaled or translated off
    // the viewport is exactly as useless as a hidden one.
    firstIconOnScreen: !!rect && rect.width > 0 && rect.height > 0 &&
      rect.top >= 0 && rect.left >= 0 &&
      rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
    running: typeof runningApps === 'undefined' ? -1 : runningApps.length,
    // A phone desktop is taller than a phone. If the grid overflows and does
    // not scroll, the icons past the fold are simply gone.
    overflows: icons ? icons.scrollHeight > icons.clientHeight + 1 : false,
    scrollable: style ? (style.overflowY === 'auto' || style.overflowY === 'scroll') : false,
    takesTouches: style ? style.pointerEvents !== 'none' : false,
    // The build watermark is how anyone answers "is this phone on the new
    // version at all", so it has to be somewhere a phone can see.
    stamp: (() => {
      const el = document.getElementById('build-stamp');
      if (!el || getComputedStyle(el).display === 'none') return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, onScreen: r.bottom <= window.innerHeight + 1 && r.top >= 0 };
    })(),
  };
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = process.env.BASE_URL ? null : await startStaticServer();
  const base = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--no-first-run'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
    // The iPhone: no element Fullscreen API, so "full screen" is the page
    // fallback and nothing will ever fire a fullscreenchange event.
    await page.evaluateOnNewDocument(() => {
      for (const name of ['requestFullscreen', 'webkitRequestFullscreen',
                          'mozRequestFullScreen', 'msRequestFullscreen']) {
        delete Element.prototype[name];
      }
    });
    await page.goto(`${base}/index.html?single-app=1&quit-test=${Date.now()}`,
      { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof launchApp === 'function' &&
      document.querySelector('.desktop-icon'), { timeout: 60000 });

    const idle = await page.evaluate(desktopState);
    assert(idle.classes.includes('single-app'), `phone viewport should be single-app, got "${idle.classes}"`);
    assert(idle.iconCount > 0, 'the desktop should have icons to launch from');
    assert.strictEqual(idle.display, 'grid', 'the idle desktop shows its icons');

    // Launch by tapping an icon, which on a phone is the only way in.
    await page.evaluate(() => {
      const icon = [...document.querySelectorAll('.desktop-icon')]
        .find(el => el.dataset.app === 'winmine_wep');
      if (!icon) throw new Error('no Minesweeper icon on the desktop');
      icon.click();
    });
    await page.waitForFunction(() => {
      const app = runningApps.find(item => item && item.name === 'winmine_wep');
      return !!(app && app.wine.running && app.wine._runSliceCount >= 40);
    }, { timeout: 120000 });
    const playing = await page.evaluate(desktopState);
    assert.strictEqual(playing.display, 'none', 'a running app owns the whole phone screen');

    // The worst case a visitor can be left in: the app took the display and
    // the page went full screen for it, and neither got taken down by an
    // event. This is the state, not a way of producing it -- the point is
    // that stopping the guest has to clear it however it came about.
    // Driven through the renderer, not by setting the classes: on a browser
    // with no Fullscreen API the display grab now takes the page with it
    // (index.html's enterPageFullscreenIfNoApi), and setting the classes by
    // hand skips exactly the code that has to be undone again on the way out.
    //
    // Pinned, not just set: winmine is not really an exclusive app, so the
    // very next repaint recomputes exclusive as false, and
    // _setExclusiveFullscreen(false) then calls exitPageFullscreen for it --
    // the state under test is gone again before it can be read. That race is
    // decided by how many repaints land between two page.evaluate calls, so
    // on a loaded box it lost every time. Force the renderer's own verdict the
    // way test/test-web-page-fullscreen.js does, which is also what a real
    // full-screen game looks like: exclusive on every frame.
    await page.evaluate(() => {
      const app = runningApps.find(item => item && item.name === 'winmine_wep');
      // `win => !!win` rather than a flat `true`: the renderer asks this about
      // the top window on every repaint including the one with no windows
      // left, and a verdict of "exclusive" on an empty desktop would hand the
      // page to a guest that is gone -- which is the very thing the rest of
      // this test is checking does not happen.
      app.wine.renderer._isExclusiveFullscreenWindow = win => !!win;
      app.wine.renderer._setExclusiveFullscreen(true);
    });
    await page.waitForFunction(
      () => document.body.classList.contains('page-fullscreen'), { timeout: 10000 });
    const owned = await page.evaluate(() => document.body.className);
    assert(owned.includes('page-fullscreen'),
      `an exclusive app on an API-less browser should own the page, got "${owned}"`);
    // Stopped the pathological way, not the tidy way: something cleared
    // `running` before stop() was reached -- an exit taken inside the run
    // loop, a trap, a second stop() -- which used to swallow the shell's only
    // notification. The entry then lived forever in runningApps, and on a
    // phone that is terminal: the renderer has already dropped the guest's
    // windows so the page is bare teal, the icons stay hidden behind
    // body.app-running, and single-app mode refuses every later launch in
    // silence because it still believes something is running.
    // Plant the window a worker thread of this app would have put up. The
    // whole app slice is the shell's unit of ownership, so a window from any
    // of its threads has to go down with it -- when worker bases were derived
    // from the thread id alone, this one landed outside the slice, outlived
    // its guest, and the repaint after the stop handed the display straight
    // back to the dead app.
    const workerHwnd = await page.evaluate(() => {
      const app = runningApps.find(item => item && item.name === 'winmine_wep');
      const hwnd = app.wine.threadManager
        ? app.wine.threadManager.workerHwndBase(1)
        : app.wine._hwndBase + 0x8000;
      app.wine.renderer.windows[hwnd] = {
        hwnd, x: 0, y: 0, width: 320, height: 200,
        visible: true, title: 'worker window', wasm: null,
      };
      return hwnd;
    });

    await page.evaluate(() => {
      const app = runningApps.find(item => item && item.name === 'winmine_wep');
      app.wine.running = false;
      app.wine.stop({ repaint: false });
      if (app.wine.renderer) app.wine.renderer.repaint();
    });
    const workerWindowLeft = await page.evaluate(
      hwnd => !!(sharedRenderer && sharedRenderer.windows[hwnd]), workerHwnd);
    assert(!workerWindowLeft,
      `a window from worker thread 1 (hwnd 0x${workerHwnd.toString(16)}) outlived its app`);
    await page.waitForFunction(() => runningApps.length === 0, { timeout: 30000 });
    const quit = await page.evaluate(desktopState);
    await page.screenshot({ path: path.join(OUT, 'after-quit.png') });

    assert.strictEqual(quit.running, 0, 'the app really stopped');
    assert.strictEqual(quit.display, 'grid',
      `the desktop must come back when the last app quits, body was "${quit.classes}"`);
    assert(!quit.classes.includes('page-fullscreen'),
      'nothing is running, so nothing owns the page');
    assert(!quit.classes.includes('exclusive-fullscreen'),
      'nothing is running, so nothing owns the display');
    assert(quit.firstIconOnScreen, 'the first icon has to be tappable, not just displayed');

    // Every icon has to be reachable, not just the ones above the fold. The
    // grid is sized to the guest screen, so on a phone eight rows of icons do
    // not fit and the ones below are unreachable unless it scrolls itself --
    // and it can only scroll if it takes the touches, because the canvas sits
    // over it and preventDefaults them away to the guest.
    // Chrome's device emulation cannot reproduce this one: it has no
    // retractable toolbars, so vh and dvh are the same number and the page
    // measures correct either way. On a real iPhone 100vh is the height the
    // page would have if Safari's bars were hidden, so the bottom ~70px of
    // the desktop sits behind them -- and because the grid was then taller
    // than the screen showed, it never overflowed and never scrolled. Assert
    // the rule itself, since no measurement here can.
    const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
    assert(/body:not\(\.app-running\)\s*\{\s*height:\s*100dvh/.test(source),
      'the idle desktop must be sized in dvh, or its last row hides behind Safari');

    assert(quit.scrollable, 'the phone desktop must scroll');
    assert(quit.takesTouches, 'a grid with pointer-events:none cannot be scrolled by a finger');
    assert(quit.stamp && quit.stamp.onScreen,
      `the build watermark has to be visible on the idle desktop, got ${JSON.stringify(quit.stamp)}`);
    assert(/build /.test(quit.stamp.text), 'the watermark has to name a build');
    if (quit.overflows) {
      const lastIcon = await page.evaluate(() => {
        const grid = document.getElementById('desktop-icons');
        const icons = [...document.querySelectorAll('.desktop-icon')];
        const last = icons[icons.length - 1];
        grid.scrollTop = grid.scrollHeight;
        const rect = last.getBoundingClientRect();
        const box = grid.getBoundingClientRect();
        return {
          scrolled: grid.scrollTop > 0,
          onScreen: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 &&
            rect.bottom <= window.innerHeight + 1,
          app: last.dataset.app,
        };
      });
      assert(lastIcon.scrolled, 'an overflowing grid must actually scroll');
      assert(lastIcon.onScreen,
        `the last icon (${lastIcon.app}) must be reachable by scrolling`);
      await page.screenshot({ path: path.join(OUT, 'desktop-scrolled.png') });
      await page.evaluate(() => { document.getElementById('desktop-icons').scrollTop = 0; });
    }

    // And the desktop has to work, not just appear. The exclusive verdict
    // pinned on the shared renderer above belonged to Minesweeper; left in
    // place it would call Notepad's window exclusive too, and the windowed
    // checks below could never hold.
    await page.evaluate(() => { delete sharedRenderer._isExclusiveFullscreenWindow; });
    await page.evaluate(() => {
      const icon = [...document.querySelectorAll('.desktop-icon')]
        .find(el => el.dataset.app === 'notepad');
      if (!icon) throw new Error('no Notepad icon on the desktop');
      icon.click();
    });
    await page.waitForFunction(() => runningApps.some(item => item && item.name === 'notepad'),
      { timeout: 120000 });

    // ------------------------------------------------------------------
    // The exit chip. Reported as "'Close' button don't seem to do anything on
    // this pinball view": the round X at the top right while a full-screen
    // game owns the phone.
    //
    // Two separate failures are possible and they look identical from the
    // outside, so both are measured here. Either something on the overlay
    // stack (the guest canvas, a touch-control zone) sits over the chip and
    // swallows the touch, or the tap lands and the handler is a visual no-op
    // -- which is what it was: the chip called exitPageFullscreen, and in
    // single-app mode leaving page-fullscreen changed nothing on screen (the
    // app already had every pixel), leaving the desktop icons hidden behind
    // `app-running`. One tap and there was nothing left to press.
    //
    // Nothing here is pinball-specific: any app that takes the display goes
    // through this same chip, so the check rides on the app that is already
    // running.
    await page.waitForFunction(() => {
      const app = runningApps.find(item => item && item.name === 'notepad');
      return !!(app && app.wine && app.wine.renderer);
    }, { timeout: 60000 });
    await page.waitForFunction(() => document.body.classList.contains('windowed-phone'),
      { timeout: 10000 });
    const windowedClose = await page.evaluate(() => {
      const chip = document.getElementById('page-fullscreen-exit');
      return { display: getComputedStyle(chip).display };
    });
    assert.strictEqual(windowedClose.display, 'none',
      'windowed apps use their own titlebar Close button without a duplicate chip');
    await page.evaluate(() => {
      const app = runningApps.find(item => item && item.name === 'notepad');
      // Pinned for the same reason as above: a chip that is only on screen
      // until the next repaint is not the thing being measured.
      app.wine.renderer._isExclusiveFullscreenWindow = win => !!win;
      app.wine.renderer._setExclusiveFullscreen(true);
    });
    await page.waitForFunction(
      () => document.body.classList.contains('page-fullscreen'), { timeout: 10000 });
    const chip = await page.evaluate(() => {
      const el = document.getElementById('page-fullscreen-exit');
      if (!el) return { missing: true };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const overlay = document.getElementById('touch-controls');
      return {
        display: getComputedStyle(el).display,
        w: r.width, h: r.height, cx, cy,
        // Who actually receives a touch at that point. Anything but the chip
        // itself means the tap never reaches the handler at all.
        hit: hit ? (hit.id || hit.className || hit.tagName) : 'none',
        // The visible circle is 30px, under Apple's 44px minimum, so the
        // button carries a transparent ::before that widens the TARGET. A
        // point just outside the drawn edge has to still be the button.
        slopHit: (() => {
          const near = document.elementFromPoint(cx, Math.max(0, r.top - 5));
          return near ? (near.id || near.className || near.tagName) : 'none';
        })(),
        chipZ: parseInt(getComputedStyle(el).zIndex, 10),
        // The overlay and the chip share a parent (#screen-wrap), so their
        // z-index values are directly comparable; the in-place zones pinball
        // spreads over the table live inside it.
        overlayZ: overlay ? parseInt(getComputedStyle(overlay).zIndex, 10) : null,
        classes: document.body.className,
      };
    });
    assert(!chip.missing, 'the page has no exit chip at all');
    assert.notStrictEqual(chip.display, 'none',
      `the exit chip must be on screen while an app owns the display, body "${chip.classes}"`);
    assert(chip.w >= 28 && chip.h >= 28,
      `the exit chip is the only way out; it must stay a real touch target, got ${chip.w}x${chip.h}`);
    assert.strictEqual(chip.slopHit, 'page-fullscreen-exit',
      `a touch 5px above the chip lands on "${chip.slopHit}"; the 30px circle needs ` +
      `its widened target, or a near miss reads as a dead button`);
    assert.strictEqual(chip.hit, 'page-fullscreen-exit',
      `a touch at the exit chip's own centre lands on "${chip.hit}" instead of the chip`);
    if (chip.overlayZ !== null) {
      assert(chip.overlayZ < chip.chipZ,
        `the touch-control overlay (z ${chip.overlayZ}) must stay under the exit chip (z ${chip.chipZ})`);
    }

    // A real touch at the measured point, not a synthesized element.click():
    // the question under test is whether a finger there reaches the handler.
    await page.touchscreen.tap(chip.cx, chip.cy);
    await page.waitForFunction(() => runningApps.length === 0, { timeout: 30000 });
    const afterChip = await page.evaluate(desktopState);
    await page.screenshot({ path: path.join(OUT, 'after-exit-chip.png') });
    assert.strictEqual(afterChip.running, 0, 'the exit chip has to end the app, not just the fullscreen layout');
    assert.strictEqual(afterChip.display, 'grid',
      `the exit chip must give the launcher back, body was "${afterChip.classes}"`);
    for (const cls of ['app-running', 'exclusive-fullscreen', 'page-fullscreen']) {
      assert(!afterChip.classes.includes(cls),
        `"${cls}" survived the exit chip: body was "${afterChip.classes}"`);
    }
    assert(afterChip.firstIconOnScreen, 'the icons the exit chip returns to must be tappable');

    console.log('PASS  quitting an app in single-app mode gives the desktop back');
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
