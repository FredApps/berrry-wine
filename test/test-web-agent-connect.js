#!/usr/bin/env node
// "Connect an Agent" end to end (docs/design-agent-connect.md): a real Chrome
// page, the SHIPPED bridge (skills/wine-assembly-connect/scripts/wine-agent.mjs)
// as a separate process, and the dev-server standing in for berrry — its
// nomcp registration and Bearer brry_ data writes included. Nothing is
// mocked between the two ends: the token is the one the page made, the
// answer travels through the store sealed, and commands cross a real
// WebRTC DataChannel.
//
// PASS criteria:
//   - the page makes a link whose #fragment carries the wa1 token
//   - a first-run bridge asks to register; POST /register with the puzzle
//     answer registers it as a bot
//   - the page finds the sealed answer and asks, naming the bot and its label
//   - nothing is reachable before Allow; after Allow the bridge is connected
//   - the pairing record is deleted once the channel is open
//   - snapshot and screenshot.png come back over the channel (real PNG bytes)
//   - the player's checkboxes and modes are enforced page-side (control off,
//     watch-only via Take back, eval refused off ?debug)
//   - the local API refuses a request without the key or with a foreign Host
//   - a disconnect from the agent closes the page side
//   - the same through Start → Connect Agent…: link, consent dialog (a known
//     bot, signing in without registering), Allow, tray icon, Take back pill,
//     Disconnect. Screenshots of each dialog state go to build/agent-connect/.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRIDGE = path.join(ROOT, 'skills', 'wine-assembly-connect', 'scripts', 'wine-agent.mjs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A free port, not a fixed one: other sessions on this box run dev-servers.
const SHOTS = path.join(ROOT, 'build', 'agent-connect');
const PORT = (() => {
  const net = require('net');
  const { execFileSync } = require('child_process');
  return Number(execFileSync(process.execPath, ['-e',
    "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());
})();

if (!fs.existsSync(CHROME)) { console.log('SKIP  Chrome not found'); process.exit(0); }
let puppeteer;
try { puppeteer = require('puppeteer'); } catch (_) { console.log('SKIP  puppeteer not installed'); process.exit(0); }
if (!fs.existsSync(BRIDGE)) { console.log('FAIL  bridge not built: node tools/wine-agent/build.js'); process.exit(1); }

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wine-agent-'));
let failed = false;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failed = true;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(what, fn, ms) {
  const deadline = Date.now() + (ms || 20000);
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Raw http so a test can send a forged Host header (fetch will not).
function request(base, method, route, { key, body, host } = {}) {
  const u = new URL(route, base);
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (host) headers.Host = host;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (/json/.test(res.headers['content-type'] || '')) { try { json = JSON.parse(buf.toString('utf8')); } catch (_) {} }
        resolve({ status: res.statusCode, json, buf, type: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = spawn('node', [path.join(ROOT, 'tools', 'dev-server.js'), `--port=${PORT}`, '--quiet'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', d => { serverOut += d; });
server.stderr.on('data', d => { serverOut += d; });

let browser = null;
let bridge = null;
let bridgeOut = '';

(async () => {
  await until('dev-server', () => serverOut.includes('dev server:') || server.exitCode !== null, 60000);
  if (!serverOut.includes('dev server:')) throw new Error(`dev-server did not start:\n${serverOut}`);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 700 });
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#screen', { timeout: 15000 });

  const link = await page.evaluate(async () => {
    const m = await import('/lib/agent-connect.js');
    window.__states = [];
    window.__pairing = await m.startPairing({ onState: s => window.__states.push(s) });
    return window.__pairing.link;
  });
  check('page makes a skill link with the token in its fragment',
    /^http:\/\/127\.0\.0\.1:\d+\/skills\/wine-assembly-connect\/SKILL\.md#wa1\.[A-Za-z0-9_-]+$/.test(link), link);
  const token = link.split('#')[1];
  check('the token fits one chat line', token.length < 260, `${token.length} chars`);

  // What an agent does first (SKILL.md step 1): fetch the skill and the
  // bridge from the site and check the bridge against SHA256SUMS.txt.
  const site = `http://127.0.0.1:${PORT}`;
  const skillMd = await request(site, 'GET', '/skills/wine-assembly-connect/SKILL.md');
  const mjs = await request(site, 'GET', '/skills/wine-assembly-connect/scripts/wine-agent.mjs');
  const sums = await request(site, 'GET', '/skills/wine-assembly-connect/scripts/SHA256SUMS.txt');
  const served = require('crypto').createHash('sha256').update(mjs.buf).digest('hex');
  check('the site serves SKILL.md and a bridge matching SHA256SUMS.txt',
    skillMd.status === 200 && /^---\nname: wine-assembly-connect/.test(skillMd.buf.toString())
      && mjs.status === 200 && sums.buf.toString() === `${served}  wine-agent.mjs\n`,
    `${skillMd.status} ${mjs.status} ${sums.status} ${served}`);

  bridge = spawn('node', [BRIDGE, `Play my game: ${link}`, `--config-dir=${configDir}`, '--runs-as=Test Harness'],
    { cwd: configDir, stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.on('data', d => { bridgeOut += d; });
  bridge.stderr.on('data', d => { bridgeOut += d; });

  const ready = await until('READY line', () => /READY (http:\/\/127\.0\.0\.1:\d+) key=([0-9a-f]+)/.exec(bridgeOut));
  const [, base, key] = ready;

  check('the local API refuses a request without the key',
    (await request(base, 'GET', '/status')).status === 401, 'expected 401');
  check('the local API refuses a foreign Host header',
    (await request(base, 'GET', '/status', { key, host: 'evil.example:80' })).status === 403, 'expected 403');

  await until('REGISTER line', () => bridgeOut.includes('REGISTER '));
  const reg = await request(base, 'GET', '/register', { key });
  check('first run exposes the registration puzzle', reg.status === 200 && reg.json && reg.json.puzzle, JSON.stringify(reg.json));
  const bad = await request(base, 'POST', '/register', { key, body: { answer: 'dev', username: 'no' } });
  check('a username without the bot suffix is refused', bad.status === 400, JSON.stringify(bad.json));
  const solved = await request(base, 'POST', '/register', { key, body: { answer: 'dev', username: 'testharnessbot' } });
  check('solving the puzzle registers the bot', solved.status === 200 && solved.json.username === 'testharnessbot', JSON.stringify(solved.json));
  check('the identity is saved 0600 in the config dir',
    (fs.statSync(path.join(configDir, 'identity.json')).mode & 0o777) === 0o600, 'mode');

  const asking = await until('page asks for consent', () => page.evaluate(() => {
    const s = window.__pairing.state;
    return s.phase === 'asking' ? s : null;
  }));
  check('the consent request names the bot, its key and its self-reported label',
    asking.bot.username === 'testharnessbot' && asking.bot.runsAs === 'Test Harness'
      && /^[0-9a-f]{4}·[0-9a-f]{4}·[0-9a-f]{4}$/.test(asking.bot.keyLabel), JSON.stringify(asking.bot));

  const before = await request(base, 'GET', '/snapshot', { key });
  check('nothing is reachable before the player allows it', before.status === 409, `${before.status} ${JSON.stringify(before.json)}`);

  const recordKey = await page.evaluate(() => window.AgentPair.recordKey(window.AgentPair.readToken(window.__pairing.state.token).id));
  const pubBefore = await request(`http://127.0.0.1:${PORT}`, 'GET', `/api/public-data/users/${encodeURIComponent(recordKey)}`);
  // The row's owner fields name the bot (that is the store's metadata, and
  // the record key is itself derived from the token); the value must not.
  const value = Array.isArray(pubBefore.json) && pubBefore.json.length === 1 ? pubBefore.json[0].value : null;
  check('the answer record\'s value is opaque without the token',
    value && value.ct && !/testharnessbot|Test Harness|a=fingerprint/.test(JSON.stringify(value)),
    JSON.stringify(pubBefore.json).slice(0, 200));

  await page.evaluate(() => window.__pairing.allow({ remember: true }));
  await until('bridge connected', async () => {
    const s = await request(base, 'GET', '/status', { key });
    return s.json && s.json.state === 'connected';
  });
  check('after Allow the bridge is connected', true);

  const pubAfter = await until('record deleted', async () => {
    const r = await request(`http://127.0.0.1:${PORT}`, 'GET', `/api/public-data/users/${encodeURIComponent(recordKey)}`);
    return Array.isArray(r.json) && r.json.length === 0 ? r : null;
  }, 10000).catch(() => null);
  check('the pairing record is deleted once the channel is open', !!pubAfter, 'still there');

  const snap = await request(base, 'GET', '/snapshot', { key });
  check('snapshot comes back over the channel',
    snap.status === 200 && snap.json.ok && snap.json.value.screen && snap.json.value.screen.w > 0, JSON.stringify(snap.json));

  const png = await request(base, 'GET', '/screenshot.png', { key });
  const sig = png.buf.slice(0, 8).toString('hex');
  check('screenshot.png is a real PNG', png.status === 200 && png.type === 'image/png' && sig === '89504e470d0a1a0a',
    `${png.status} ${png.type} ${sig} ${png.buf.length}B`);

  const click = await request(base, 'POST', '/click', { key, body: { x: 10, y: 10 } });
  check('a click runs page-side', click.status === 200 && click.json.ok, JSON.stringify(click.json));

  await page.evaluate(() => window.__pairing.setPerms({ control: false }));
  const refused = await request(base, 'POST', '/key', { key, body: { key: 'Enter' } });
  check('control off: input is refused by the page',
    refused.status === 422 && /did not allow mouse and keyboard/.test(refused.json.error), JSON.stringify(refused.json));
  const stillSees = await request(base, 'GET', '/snapshot', { key });
  check('control off: observation still works', stillSees.status === 200, String(stillSees.status));
  await page.evaluate(() => window.__pairing.setPerms({ control: true }));

  const ev = await request(base, 'POST', '/eval', { key, body: { code: '1+1' } });
  check('eval is refused off ?debug even if the agent asks', ev.status === 422, JSON.stringify(ev.json));

  await page.evaluate(() => window.__pairing.takeBack());
  const watch = await request(base, 'POST', '/click', { key, body: { x: 10, y: 10 } });
  check('Take back switches to watch-only and refuses input', watch.status === 422 && /watch-only/.test(watch.json.error), JSON.stringify(watch.json));
  const status = await request(base, 'GET', '/status', { key });
  check('the agent is told about the mode change',
    status.json.lastEvent && status.json.lastEvent.type === 'mode' && status.json.lastEvent.mode === 'watch', JSON.stringify(status.json.lastEvent));

  await request(base, 'POST', '/disconnect', { key });
  const closed = await until('page closed', () => page.evaluate(() => {
    const s = window.__pairing.state;
    return s.phase === 'closed' ? s : null;
  }), 10000).catch(() => null);
  check('a disconnect from the agent closes the page side', !!closed, 'page still connected');

  const known = await page.evaluate(() => JSON.parse(localStorage.getItem('wa.agent.known') || '[]'));
  check('"Remember this agent" stored the key', known.length === 1 && known[0].username === 'testharnessbot', JSON.stringify(known));

  // ---- the same thing through the Start menu, as a player does it --------
  // Second run on this machine: the bridge signs in with its saved identity
  // and must not ask to register again.
  await page.click('#start-btn');
  await page.click('#start-agent-item');
  await page.waitForSelector('#wa-agent-dialog input.link', { visible: true, timeout: 15000 });
  const uiLink = await page.$eval('#wa-agent-dialog input.link', el => el.value);
  await shot('1-pair');
  // Draggable by its title bar like the Read Me window, and it stays where it
  // was put when the next state rebuilds the dialog.
  const start = await page.$eval('#wa-agent-dialog', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.move(start.x + 60, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y - 30, { steps: 4 });
  await page.mouse.move(start.x - 40, start.y - 70, { steps: 4 });
  await page.mouse.up();
  const moved = await page.$eval('#wa-agent-dialog', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  check('the dialog drags by its title bar',
    Math.abs(moved.x - (start.x - 100)) <= 1 && Math.abs(moved.y - (start.y - 80)) <= 1,
    `${JSON.stringify(start)} -> ${JSON.stringify(moved)}`);
  check('Start → Connect Agent… shows a fresh link', /#wa1\./.test(uiLink) && uiLink !== link, uiLink);

  bridgeOut = '';
  bridge = spawn('node', [BRIDGE, uiLink, `--config-dir=${configDir}`, '--runs-as=Test Harness'],
    { cwd: configDir, stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.on('data', d => { bridgeOut += d; });
  bridge.stderr.on('data', d => { bridgeOut += d; });
  const [, base2, key2] = await until('second READY line', () => /READY (http:\/\/127\.0\.0\.1:\d+) key=([0-9a-f]+)/.exec(bridgeOut));

  const askText = await until('consent dialog', () => page.evaluate(() => {
    const d = document.getElementById('wa-agent-dialog');
    return d && !d.hidden && /wants to connect/.test(d.textContent) ? d.textContent : null;
  }));
  await shot('2-request');
  const kept = await page.$eval('#wa-agent-dialog', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  check('a dragged dialog keeps its place across state changes',
    Math.abs(kept.x - moved.x) <= 1 && Math.abs(kept.y - moved.y) <= 1, `${JSON.stringify(moved)} -> ${JSON.stringify(kept)}`);
  check('a known bot signs in without registering again', !/REGISTER /.test(bridgeOut), bridgeOut);
  check('the dialog names the bot, says it is remembered and marks its label unverified',
    /testharnessbot wants to connect/.test(askText) && /known since/.test(askText) && /Test Harness \(unverified\)/.test(askText), askText);

  await page.click('#wa-agent-dialog button.btn.default'); // Allow
  await until('second bridge connected', async () => {
    const st = await request(base2, 'GET', '/status', { key: key2 });
    return st.json && st.json.state === 'connected';
  });
  check('Allow in the dialog connects', true);
  const trayShown = await page.$eval('#wa-agent-tray', el => !el.hidden);
  check('the taskbar shows the agent icon', trayShown, 'hidden');

  await request(base2, 'POST', '/click', { key: key2, body: { x: 5, y: 5 } });
  const pillShown = await until('Take back pill', () => page.$eval('#wa-agent-pill', el => !el.hidden), 5000).catch(() => false);
  await shot('3-connected');
  check('the Take back pill appears once the agent drives', pillShown, 'pill hidden');

  await page.click('#wa-agent-pill');
  const refusedUi = await request(base2, 'POST', '/click', { key: key2, body: { x: 5, y: 5 } });
  const watchChecked = await page.$eval('#wa-agent-dialog input[value=watch]', el => el.checked);
  check('the pill hands input back and the dialog shows watch-only',
    refusedUi.status === 422 && watchChecked && await page.$eval('#wa-agent-pill', el => el.hidden),
    `${refusedUi.status} watch=${watchChecked}`);

  const discBtn = await page.$$('#wa-agent-dialog button.btn');
  for (const btn of discBtn) {
    if ((await btn.evaluate(el => el.textContent)) === 'Disconnect') { await btn.click(); break; }
  }
  const endText = await until('ended dialog', () => page.evaluate(() => {
    const d = document.getElementById('wa-agent-dialog');
    return d && /disconnected/.test(d.textContent) ? d.textContent : null;
  }), 5000).catch(() => '');
  await shot('4-ended');
  check('Disconnect in the dialog ends the session', /The agent is disconnected/.test(endText), endText);
  const agentSide = await until('bridge sees bye', async () => {
    const st = await request(base2, 'GET', '/status', { key: key2 });
    return st.json && st.json.state === 'closed' ? st.json : null;
  }, 10000).catch(() => null);
  check('the agent is told the player disconnected', !!agentSide && /player disconnected/.test(agentSide.error), JSON.stringify(agentSide));
  check('the tray icon goes away', await page.$eval('#wa-agent-tray', el => el.hidden), 'still shown');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
})().catch((err) => {
  failed = true;
  console.log(`FAIL  ${err && err.message || err}`);
  console.log(`--- bridge output ---\n${bridgeOut}`);
}).finally(async () => {
  try { if (browser) await browser.close(); } catch (_) {}
  try { if (bridge) bridge.kill(); } catch (_) {}
  server.kill();
  fs.rmSync(configDir, { recursive: true, force: true });
  console.log(failed ? '\nFAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
});
