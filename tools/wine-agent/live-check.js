#!/usr/bin/env node
// Does Connect Agent work against a REAL berrry? Plays the page's half in
// Node (werift instead of Chrome) and runs the shipped bridge against the
// given origin, so every berrry leg is the production one:
//
//   nomcp register/sign-in -> POST /api/data/agentpair:<id> with Bearer brry_rw_
//   -> anonymous GET /api/public-data/users/<key> -> DataChannel opens
//   -> the bridge DELETEs the record
//
//   node tools/wine-agent/live-check.js [--origin=https://wine-assembly.berrry.app]
//        [--config-dir=DIR] [--name=somethingbot]
//
// A first run on a config dir has to register a bot, which takes a captcha
// only an agent or person can answer: the puzzle is printed, and the run
// waits up to 3 minutes for "<answer>" to appear in DIR/answer.txt.
// A config dir that already holds a registered identity skips that.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { RTCPeerConnection } = require('werift');
const pair = require('../../lib/agent-pair');

const ROOT = path.resolve(__dirname, '..', '..');
const BRIDGE = path.join(ROOT, 'skills', 'wine-assembly-connect', 'scripts', 'wine-agent.mjs');
const flag = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ORIGIN = flag('origin', 'https://wine-assembly.berrry.app').replace(/\/$/, '');
const DIR = flag('config-dir', path.join(os.tmpdir(), 'wine-agent-live'));
const NAME = flag('name', 'waconnectcheckbot');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const report = (name, ok, detail) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
};

function local(base, key, method, route, body) {
  const u = new URL(route, base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(t) }); } catch (_) { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500); }
  return null;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const answerFile = path.join(DIR, 'answer.txt');
  try { fs.unlinkSync(answerFile); } catch (_) {}

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const channel = pc.createDataChannel('agent', { ordered: true });
  const opened = new Promise((r) => {
    channel.onopen = () => r(true);
    if (channel.stateChanged) channel.stateChanged.subscribe(s => { if (s === 'open') r(true); });
  });
  await pc.setLocalDescription(await pc.createOffer());
  await until(() => pc.iceGatheringState === 'complete', 5000);
  const made = pair.makeToken(pc.localDescription.sdp);
  const recordKey = pair.recordKey(made.id);
  console.log(`origin ${ORIGIN}, token ${made.token.length} chars, record ${recordKey}`);

  let out = '';
  const bridge = spawn(process.execPath, [BRIDGE, `${ORIGIN}/skills/wine-assembly-connect/SKILL.md#${made.token}`,
    `--config-dir=${DIR}`, '--runs-as=live-check'], { stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.on('data', d => { out += d; process.stdout.write(`  | ${d}`); });
  bridge.stderr.on('data', d => { out += d; process.stdout.write(`  | ${d}`); });

  try {
    const ready = await until(() => /READY (\S+) key=(\w+)/.exec(out), 15000);
    if (!ready) throw new Error('bridge never printed READY');
    const [, base, key] = ready;

    const phase = await until(() => /REGISTER |ASKING |FAILED /.exec(out), 30000);
    if (phase && phase[0] === 'REGISTER ') {
      const reg = await local(base, key, 'GET', '/register');
      console.log(`\nPUZZLE ${JSON.stringify(reg.json && reg.json.puzzle)}\nwrite the answer to ${answerFile}\n`);
      const answer = await until(() => fs.existsSync(answerFile) && fs.readFileSync(answerFile, 'utf8').trim(), 180000);
      if (!answer) throw new Error('no answer within 3 minutes');
      const solved = await local(base, key, 'POST', '/register', { answer, username: NAME });
      report('nomcp registration', solved.status === 200, JSON.stringify(solved.json));
      if (solved.status !== 200) throw new Error('registration failed');
    } else {
      report('nomcp sign-in with a saved identity', !!phase && phase[0] === 'ASKING ', phase && phase[0]);
    }

    const asking = await until(() => /ASKING |FAILED /.exec(out), 30000);
    report('bridge published its answer (Bearer brry_rw_ write to /api/data)', !!asking && asking[0] === 'ASKING ',
      (/FAILED .*|WARN .*/.exec(out) || [''])[0]);
    if (!asking || asking[0] !== 'ASKING ') throw new Error('no answer published');

    const row = await until(async () => {
      const r = await fetch(`${ORIGIN}/api/public-data/users/${encodeURIComponent(recordKey)}?fresh=${Date.now()}`, { cache: 'no-store' });
      const rows = r.ok ? await r.json() : [];
      return Array.isArray(rows) && rows[0];
    }, 15000);
    report('anonymous read of the public record', !!row);
    if (!row) throw new Error('record not readable');
    const bytes = Buffer.byteLength(JSON.stringify(row.value));
    report('record value under the 2 KB cap', bytes <= 2048, `${bytes} bytes`);
    const answer = pair.openAnswer(made, row.value);
    report('sealed answer opens and its signature verifies', !!answer, answer && `bot ${answer.bot.username} key ${answer.bot.keyLabel}`);
    if (!answer) throw new Error('could not open answer');

    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    const open = await Promise.race([opened, sleep(20000).then(() => false)]);
    report('DataChannel opens over the production-signalled answer', open);

    const gone = await until(async () => {
      const r = await fetch(`${ORIGIN}/api/public-data/users/${encodeURIComponent(recordKey)}?fresh=${Date.now()}`, { cache: 'no-store' });
      const rows = r.ok ? await r.json() : null;
      return Array.isArray(rows) && rows.length === 0;
    }, 15000);
    report('bridge deleted the record (Bearer DELETE)', !!gone);
    await local(base, key, 'POST', '/disconnect').catch(() => {});
  } catch (err) {
    report(String(err.message || err), false);
  } finally {
    bridge.kill();
    try { await pc.close(); } catch (_) {}
    console.log(failed ? '\nFAILED' : '\nall OK');
    process.exit(failed ? 1 : 0);
  }
})();
