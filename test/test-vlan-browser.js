#!/usr/bin/env node
// Two browsers, one segment, a frame that crosses between them.
//
// Everything below the DataChannel is covered elsewhere: test-vlan-rtc.js
// checks the crypto and the wire contract against a stand-in channel, and
// test-vlan-match.js drives the real game over the process wire. The one link
// neither of those touches is the real thing — two pages, two users, an actual
// peer connection — and that is what this covers.
//
// It drives the lobby directly rather than launching a game: the emulator boot
// is minutes of unrelated work, and what is being tested is the introduction,
// not Liquid War.
//
// Needs a real Chrome. Skips cleanly when there is not one, because a machine
// without a browser is not a failing machine.

'use strict';

const fs = require('fs');
const path = require('path');
const { createServer } = require('../tools/dev-server');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  return null;
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    console.log('test-vlan-browser: SKIP (puppeteer not installed)');
    return process.exit(0);
  }

  // puppeteer's own download may be absent; a system Chrome is fine.
  let executablePath = null;
  try {
    const p = puppeteer.executablePath();
    executablePath = (typeof p === 'string' && p && fs.existsSync(p)) ? p : null;
  } catch (_) {}
  if (!executablePath) executablePath = findChrome();
  if (!executablePath) {
    console.log('test-vlan-browser: SKIP (no Chrome; set CHROME_PATH to run)');
    return process.exit(0);
  }

  // 127.0.0.1 is a SECURE CONTEXT, so the default run cannot say anything
  // about the case this feature was built for: a phone loading the dev server
  // at http://<lan-ip>, where crypto.subtle does not exist. VLAN_TEST_HOST
  // binds somewhere else so the same checks run over a plainly insecure
  // origin -- that run is the gate on lib/vendor/tweetnacl.js, and the
  // secure-context assertion below refuses to let it pass by accident:
  //
  //   VLAN_TEST_HOST=$(ipconfig getifaddr en0) node test/test-vlan-browser.js
  const host = process.env.VLAN_TEST_HOST || '127.0.0.1';
  const server = createServer({ quiet: true });
  await new Promise(resolve => server.listen(0, host, resolve));
  const base = `http://${host}:${server.address().port}`;
  if (host !== '127.0.0.1') console.log(`(insecure-origin run against ${base})`);
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox'] });

  try {
    // Separate browser contexts, so the two pages carry different cookies and
    // are therefore different users to the signaling service. Two tabs in one
    // context would be one user talking to itself.
    const open = async (name) => {
      const ctx = browser.createBrowserContext
        ? await browser.createBrowserContext()
        : await browser.createIncognitoBrowserContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
      // Start the lobby and keep the promise; the result is collected later.
      await page.evaluate((who) => {
        window.__lan = { done: false, error: null, result: null };
        VlanLobby.showLobby({ exe: 'lwwin.exe', name: who })
          .then(r => { window.__lan.result = r; window.__lan.done = true; })
          .catch(e => { window.__lan.error = String(e && e.message || e); window.__lan.done = true; });
      }, name);
      return { name, page, ctx, errors };
    };

    const a = await open('alpha');
    const b = await open('beta');

    // What the page actually got. On 127.0.0.1 this is a secure context with
    // WebCrypto present and the run proves only that nothing regressed; with
    // VLAN_TEST_HOST it must be insecure and subtle-less, or the run is not
    // testing what it claims and says so instead of passing quietly.
    const ctxOf = ({ page }) => page.evaluate(() => ({
      secure: isSecureContext,
      subtle: !!(self.crypto && self.crypto.subtle),
      nacl: typeof nacl,
    }));
    const ctxA = await ctxOf(a);
    check('the vendored crypto is loaded in the page', ctxA.nacl === 'object',
      `typeof nacl === ${ctxA.nacl}`);
    if (host !== '127.0.0.1') {
      check('the origin really is insecure (no crypto.subtle)',
        ctxA.secure === false && ctxA.subtle === false,
        `isSecureContext=${ctxA.secure} crypto.subtle=${ctxA.subtle} -- `
        + 'this run must be the insecure case or it proves nothing');
    }

    const settle = async (ms) => new Promise(r => setTimeout(r, ms));
    const peerRows = ({ page }) => page.evaluate(
      () => document.querySelectorAll('.vln-peer').length);

    // Presence poll is 2s; give both a couple of rounds to see each other.
    for (let i = 0; i < 15 && !(await peerRows(a) && await peerRows(b)); i++) {
      await settle(1000);
    }

    check('each page sees the other on the segment',
      (await peerRows(a)) === 1 && (await peerRows(b)) === 1,
      `alpha saw ${await peerRows(a)}, beta saw ${await peerRows(b)}`);

    const addressOf = ({ page }) => page.evaluate(
      () => (document.querySelector('.vln-addr') || {}).textContent);
    const addrA = await addressOf(a);
    const addrB = await addressOf(b);
    // Seats in the 10.0.0.0/24 room, so these are 10.0.0.1 and 10.0.0.2 --
    // asserted as the shape rather than the exact pair, because which browser
    // reaches the presence list first is a race and either order is correct.
    const seat = /^10\.0\.0\.(\d{1,3})$/;
    check('each claimed a segment address',
      seat.test(addrA || '') && seat.test(addrB || ''),
      `alpha=${addrA} beta=${addrB}`);
    check('the two addresses differ', addrA !== addrB, `both got ${addrA}`);
    check('one of them holds the host seat, 10.0.0.1',
      addrA === '10.0.0.1' || addrB === '10.0.0.1',
      `alpha=${addrA} beta=${addrB} -- an empty room must seat its first peer at .1`);

    // Only one side clicks. The other must still end up connected — that is
    // the point of deciding roles from user ids rather than from who clicked.
    await a.page.evaluate(() => document.querySelector('.vln-peer button').click());

    const waitDone = async (p, ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const st = await p.page.evaluate(() => window.__lan);
        if (st.done) return st;
        await settle(500);
      }
      return null;
    };

    const [ra, rb] = await Promise.all([waitDone(a, 45000), waitDone(b, 45000)]);
    check('the inviting side connected', !!(ra && ra.result && !ra.error),
      ra ? ra.error || JSON.stringify(ra.result) : 'timed out');
    check('the invited side connected without clicking', !!(rb && rb.result && !rb.error),
      rb ? rb.error || JSON.stringify(rb.result) : 'timed out');

    if (ra && ra.result && rb && rb.result) {
      // A frame from one page must arrive, byte for byte, at the other. This
      // is the whole purpose of the connection; everything before it is
      // introductions.
      const sent = await a.page.evaluate(() => {
        const f = new Uint8Array(32);
        new DataView(f.buffer).setUint32(0, 0x314e4c56, true);   // 'VLN1'
        new DataView(f.buffer).setUint32(24, 4, true);           // payload length
        f.set([0xDE, 0xAD, 0xBE, 0xEF], 28);
        return window.__lan.result.wire.send(f);
      });
      check('the wire accepted a frame', sent === true, `send returned ${sent}`);

      let got = null;
      for (let i = 0; i < 20 && !got; i++) {
        got = await b.page.evaluate(() => {
          const f = window.__lan.result.wire.peek();
          return f ? Array.from(f) : null;
        });
        if (!got) await settle(250);
      }
      check('the frame arrived at the other browser', !!got,
        'nothing was peekable within 5s');
      if (got) {
        check('the frame arrived unchanged',
          got.length === 32 && got.slice(28).join(',') === '222,173,190,239',
          `got ${got.length} bytes ending ${got.slice(28)}`);
      }

      const backwards = await b.page.evaluate(() => {
        const f = new Uint8Array(28);
        new DataView(f.buffer).setUint32(0, 0x314e4c56, true);
        return window.__lan.result.wire.send(f);
      });
      check('the wire carries frames in both directions', backwards === true);
    }

    for (const p of [a, b]) {
      check(`${p.name} raised no page errors`, p.errors.length === 0,
        p.errors.join('; '));
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  console.log(failures
    ? `test-vlan-browser: ${failures} FAILED`
    : 'test-vlan-browser: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
