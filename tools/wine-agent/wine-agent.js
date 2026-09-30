#!/usr/bin/env node
// wine-agent: the bridge between ANY AI agent and a wine-assembly page, over
// WebRTC. docs/design-agent-connect.md. Bundled with its dependencies into one
// file, skills/wine-assembly-connect/scripts/wine-agent.mjs, by build.js; the
// skill's SKILL.md is its user manual.
//
//   node wine-agent.mjs '<the link or wa1. token the player gave you>'
//        [--name=somethingbot] [--runs-as="Codex CLI"] [--port=N]
//        [--config-dir=DIR] [--origin=https://wine-assembly.berrry.app]
//
// What it does, in order:
//
//   1. serves a local HTTP API on 127.0.0.1 (random port, bearer secret) and
//      prints   READY http://127.0.0.1:PORT key=SECRET
//   2. signs in to berrry as this machine's bot identity (nomcp ed25519); on a
//      first run it prints REGISTER and waits for POST /register with the
//      captcha answer, because only the agent can solve that
//   3. answers the page's WebRTC offer (carried inside the token), seals the
//      answer + a signature to the pairing key and publishes it as the bot
//   4. waits for the player to click Allow; the DataChannel opens; the record
//      is deleted
//   5. turns each local HTTP request into commands on the channel, in the
//      exact protocol lib/agent-remote.js already speaks to the dev-server hub
//
// Nothing here is specific to one agent vendor, and the local API is plain
// HTTP + JSON so anything that can run curl can drive it.

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { RTCPeerConnection } = require('werift');
const nacl = require('../../lib/vendor/tweetnacl');
const pair = require('../../lib/agent-pair');

const VERSION = '0.1.0';
const DEFAULT_ORIGIN = 'https://wine-assembly.berrry.app';
const COMMAND_TIMEOUT_MS = 60000;
const STEP_TIMEOUT_MS = 600000;

// ---- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const positional = argv.filter(a => !a.startsWith('--'));

function usage(message) {
  if (message) console.error(`ERROR ${message}`);
  console.error("usage: node wine-agent.mjs '<link or wa1. token>' [--name=somethingbot] [--runs-as=LABEL] [--port=N]");
  process.exit(2);
}

if (argv.includes('--version')) { console.log(VERSION); process.exit(0); }
const pasted = positional.join(' ');
if (!pasted) usage('give the link or token the player shared with you');

let pairing;
try {
  pairing = pair.readToken(pasted);
} catch (err) {
  usage(`${err.message}. The token is the part of the link after "#", starting "wa1."`);
}

// The page that made the token is the berrry app to publish the answer to.
// The link names it; a bare token means the deployed site.
function originOf(text) {
  const m = /(https?:\/\/[^\s#/]+)/.exec(text);
  return m ? m[1] : null;
}
const ORIGIN = (flag('origin') || originOf(pasted) || DEFAULT_ORIGIN).replace(/\/$/, '');
const CONFIG_DIR = flag('config-dir') || process.env.WINE_AGENT_HOME
  || path.join(os.homedir(), '.config', 'wine-agent');
const RUNS_AS = flag('runs-as') || process.env.WINE_AGENT_RUNS_AS || '';

// ---- output: one parseable line per event -----------------------------------

const say = (tag, text) => console.log(`${tag} ${text}`);

// ---- identity and berrry session ---------------------------------------------

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

const identityFile = path.join(CONFIG_DIR, 'identity.json');
const sessionFile = path.join(CONFIG_DIR, 'session.json');

function loadIdentity() {
  const saved = readJson(identityFile);
  if (saved && saved.secretKey) {
    return { secretKey: pair.unhex(saved.secretKey), username: saved.username || null };
  }
  const kp = nacl.sign.keyPair();
  const identity = { secretKey: kp.secretKey, username: null };
  writeJson(identityFile, { secretKey: pair.hex(kp.secretKey), username: null, createdAt: new Date().toISOString() });
  return identity;
}

const identity = loadIdentity();
const pubHex = pair.hex(identity.secretKey.slice(32));
const signHex = (message) => pair.hex(nacl.sign.detached(new TextEncoder().encode(message), identity.secretKey));

async function api(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ORIGIN + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

// Session tokens are per berrry origin (the dev server and production are
// separate registries), and last 24h.
function cachedSession() {
  const all = readJson(sessionFile) || {};
  const s = all[ORIGIN];
  return s && Date.parse(s.expires_at) > Date.now() + 60000 ? s.token : null;
}

function saveSession(result) {
  const all = readJson(sessionFile) || {};
  all[ORIGIN] = { token: result.token, expires_at: result.expires_at };
  writeJson(sessionFile, all);
  if (result.username && result.username !== identity.username) {
    identity.username = result.username;
    const saved = readJson(identityFile) || {};
    writeJson(identityFile, Object.assign(saved, { username: result.username }));
  }
}

async function signIn() {
  const timestamp = String(Date.now());
  const r = await api('POST', '/api/nomcp/auth/sign-in',
    { public_key: pubHex, signature: signHex(`login:${timestamp}`), timestamp });
  if (r.status === 200 && r.body && r.body.token) { saveSession(r.body); return r.body.token; }
  if (r.status === 404) return null;   // not registered on this origin yet
  throw new Error(`sign-in failed (${r.status}): ${JSON.stringify(r.body)}`);
}

// Registration needs a captcha answer, which only the agent can give. So the
// challenge is published on GET /register and the bridge waits for POST.
let registration = null;   // { challenge, resolve }

async function register() {
  const r = await api('POST', '/api/nomcp/register/challenge', {});
  if (r.status !== 200 || !r.body || !r.body.challenge_id) {
    throw new Error(`could not get a registration challenge (${r.status}): ${JSON.stringify(r.body)}`);
  }
  const challenge = r.body;
  state.phase = 'needs-register';
  say('REGISTER', `first run on ${ORIGIN}: solve the puzzle at GET ${localBase()}/register, then`
    + ` POST ${localBase()}/register {"answer":"...","username":"<4-30 chars ending in bot>"}`);
  return new Promise((resolve) => { registration = { challenge, resolve }; });
}

async function solveRegistration(answer, username) {
  const { challenge } = registration;
  const r = await api('POST', '/api/nomcp/register/solve', {
    challenge_id: challenge.challenge_id,
    answer,
    public_key: pubHex,
    signature: signHex(`register:${challenge.nonce}`),
    username,
  });
  if ((r.status === 200 || r.status === 201) && r.body && r.body.token) {
    saveSession(r.body);
    const done = registration;
    registration = null;
    say('REGISTERED', `as ${r.body.username}`);
    done.resolve(r.body.token);
    return { ok: true, username: r.body.username };
  }
  // A wrong answer burns the challenge on berrry; fetch the next one so GET
  // /register always shows something solvable.
  if (r.body && (r.body.error === 'wrong_answer' || r.body.error === 'invalid_challenge')) {
    const next = await api('POST', '/api/nomcp/register/challenge', {});
    if (next.status === 200 && next.body) registration.challenge = next.body;
  }
  return { ok: false, status: r.status, error: r.body };
}

async function botToken() {
  return cachedSession() || await signIn() || await register();
}

// ---- WebRTC -------------------------------------------------------------------

const state = {
  phase: 'starting',   // starting | needs-register | publishing | asking | connected | closed | failed
  error: null,
  bot: null,
  channel: null,
  connectedAt: null,
  lastEvent: null,
};

const pending = new Map();   // message id -> { resolve, reject, timer }
let nextId = 1;

function gathered(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const sub = pc.iceGatheringStateChange.subscribe((s) => {
      if (s === 'complete') { sub.unSubscribe(); resolve(); }
    });
    setTimeout(resolve, 5000);
  });
}

async function connect() {
  if (pairing.expires * 1000 < Date.now()) {
    throw new Error('this link has expired; ask the player for a new one (Start ▸ Connect Agent)');
  }
  const token = await botToken();
  state.bot = identity.username;
  state.phase = 'publishing';

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.onDataChannel.subscribe((channel) => {
    if (channel.label !== 'agent') return;
    state.channel = channel;
    const receive = pair.assembler(onPageMessage);
    channel.onMessage.subscribe((m) => {
      try { receive(typeof m === 'string' ? m : Buffer.from(m).toString('utf8')); } catch (err) {
        say('WARN', `bad message from page: ${err.message}`);
      }
    });
    const opened = () => {
      state.phase = 'connected';
      state.connectedAt = Date.now();
      say('CONNECTED', 'the player allowed this agent; drive it with the local API');
      api('DELETE', `/api/data/${encodeURIComponent(pairing.recordKey)}`, undefined, token).catch(() => {});
    };
    if (channel.readyState === 'open') opened();
    channel.stateChanged.subscribe((s) => {
      if (s === 'open' && state.phase !== 'connected') opened();
      if (s === 'closed') closed('the page closed the connection');
    });
  });
  pc.connectionStateChange.subscribe((s) => {
    if (s === 'failed') closed('the connection failed (network path blocked?)');
    if (s === 'closed') closed('the connection closed');
  });

  await pc.setRemoteDescription({ type: 'offer', sdp: pair.minimalSdp(pairing.offer, 'offer') });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);

  const record = pair.sealAnswer(pairing, pc.localDescription.sdp,
    { username: identity.username, runsAs: RUNS_AS, secretKey: identity.secretKey });
  const put = await api('POST', `/api/data/${encodeURIComponent(pairing.recordKey)}?visibility=public`, record, token);
  if (put.status !== 200) {
    throw new Error(`could not publish the answer to ${ORIGIN} (${put.status}): ${JSON.stringify(put.body)}`);
  }
  state.phase = 'asking';
  say('ASKING', `the player now sees "${identity.username} wants to connect"; waiting for Allow`);

  // The page stops polling for an answer when the link expires, so an agent
  // still waiting past that point will never be let in.
  const deadline = pairing.expires * 1000 + 30000;
  const timer = setInterval(() => {
    if (state.phase === 'asking' && Date.now() > deadline) {
      clearInterval(timer);
      closed('the player did not allow the connection before the link expired');
    }
  }, 5000);
  state.pc = pc;
}

function closed(why) {
  if (state.phase === 'closed' || state.phase === 'failed') return;
  state.phase = 'closed';
  state.error = why;
  say('CLOSED', why);
  for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(why)); pending.delete(id); }
}

function onPageMessage(msg) {
  if (msg && msg.t === 'results') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg.results);
    return;
  }
  if (msg && msg.t === 'event') {
    state.lastEvent = Object.assign({ at: new Date().toISOString() }, msg.event);
    say('EVENT', JSON.stringify(msg.event));
    if (msg.event && msg.event.type === 'bye') closed('the player disconnected');
  }
}

function sendCommands(commands, timeoutMs) {
  if (state.phase !== 'connected' || !state.channel) {
    return Promise.reject(Object.assign(new Error(`not connected (state: ${state.phase})`), { status: 409 }));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error('the page did not answer in time'), { status: 504 }));
    }, timeoutMs || COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    for (const frame of pair.frames({ t: 'cmds', id, commands })) state.channel.send(frame);
  });
}

// ---- translating the local API into page commands ------------------------------

const VK = {
  RETURN: 13, ENTER: 13, ESCAPE: 27, ESC: 27, SPACE: 32, TAB: 9, BACK: 8, BACKSPACE: 8,
  DELETE: 46, INSERT: 45, HOME: 36, END: 35, PRIOR: 33, PAGEUP: 33, NEXT: 34, PAGEDOWN: 34,
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ARROWLEFT: 37, ARROWUP: 38, ARROWRIGHT: 39, ARROWDOWN: 40,
  SHIFT: 16, CONTROL: 17, CTRL: 17, MENU: 18, ALT: 18,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120,
  F10: 121, F11: 122, F12: 123,
};

function vkCode(name) {
  if (typeof name === 'number') return name;
  const upper = String(name || '').toUpperCase().replace(/^VK_/, '');
  if (/^\d+$/.test(upper)) return parseInt(upper, 10);
  if (upper in VK) return VK[upper];
  if (/^[A-Z0-9]$/.test(upper)) return upper.charCodeAt(0);
  throw Object.assign(new Error(`unknown key ${JSON.stringify(name)}: use a name like "Enter", "Escape", "Left", "F2", a letter, or a VK number`), { status: 400 });
}

function num(body, name) {
  const v = Number(body[name]);
  if (!Number.isFinite(v)) throw Object.assign(new Error(`"${name}" must be a number`), { status: 400 });
  return Math.round(v);
}

// Each route returns the commands to send, and how to turn the page's results
// into the HTTP reply. The command shapes are exactly what tools/ctl.js sends
// to the dev-server hub, so the page needs no second vocabulary.
const ROUTES = {
  'GET /snapshot': () => ({ commands: [{ action: 'snapshot' }] }),
  'GET /apps': () => ({ commands: [{ action: 'apps' }] }),
  'POST /launch': (b) => ({ commands: [{ action: 'launch', app: String(b.app || '') }] }),
  'POST /click': (b) => {
    const kind = b.button === 'right' ? 'rclick' : 'click';
    return { commands: [{ cmd: `${kind}:${num(b, 'x')}:${num(b, 'y')}` }] };
  },
  'POST /dblclick': (b) => ({ commands: [{ cmd: `dblclick:${num(b, 'x')}:${num(b, 'y')}` }] }),
  'POST /mouse': (b) => {
    const type = { down: 'mousedown', up: 'mouseup', move: 'mousemove' }[b.type] || b.type;
    if (!['mousedown', 'mouseup', 'mousemove'].includes(type)) {
      throw Object.assign(new Error('"type" must be down, up or move'), { status: 400 });
    }
    return { commands: [{ cmd: `${type}:${num(b, 'x')}:${num(b, 'y')}` }] };
  },
  'POST /drag': (b) => {
    const x1 = num(b, 'x1'), y1 = num(b, 'y1'), x2 = num(b, 'x2'), y2 = num(b, 'y2');
    const commands = [{ cmd: `mousemove:${x1}:${y1}` }, { cmd: `mousedown:${x1}:${y1}` }];
    for (const t of [0.25, 0.5, 0.75, 1]) {
      commands.push({ cmd: `mousemove:${Math.round(x1 + (x2 - x1) * t)}:${Math.round(y1 + (y2 - y1) * t)}` });
    }
    commands.push({ cmd: `mouseup:${x2}:${y2}` });
    return { commands };
  },
  'POST /wheel': (b) => ({ commands: [{ cmd: `wheel:${num(b, 'x')}:${num(b, 'y')}:${num(b, 'delta')}` }] }),
  'POST /key': (b) => {
    const code = vkCode(b.key !== undefined ? b.key : b.vk);
    if (b.type === 'down') return { commands: [{ cmd: `keydown:${code}` }] };
    if (b.type === 'up') return { commands: [{ cmd: `keyup:${code}` }] };
    return { commands: [{ cmd: `keydown:${code}` }, { cmd: `keyup:${code}` }] };
  },
  // keydown (VK), keypress (char), keyup per character: dialogs act on
  // WM_KEYDOWN and edit boxes on the WM_CHAR keypress makes (see ctl.js).
  'POST /type': (b) => {
    const text = String(b.text || '');
    if (!text) throw Object.assign(new Error('"text" is empty'), { status: 400 });
    const commands = [];
    for (const ch of text) {
      if (ch === '\n') { commands.push({ cmd: 'keydown:13' }, { cmd: 'keyup:13' }); continue; }
      const vk = /^[a-zA-Z0-9 ]$/.test(ch) ? ch.toUpperCase().charCodeAt(0) : null;
      if (vk !== null) commands.push({ cmd: `keydown:${vk}` });
      commands.push({ cmd: `keypress:${ch.charCodeAt(0)}` });
      if (vk !== null) commands.push({ cmd: `keyup:${vk}` });
    }
    return { commands };
  },
  'POST /frozen': (b) => ({ commands: [{ action: 'frozen', mode: b.on === false || b.on === 'off' ? 'off' : 'on' }] }),
  'POST /step': (b) => {
    const n = b.n === undefined ? 1 : num(b, 'n');
    if (n < 1) throw Object.assign(new Error('"n" must be at least 1'), { status: 400 });
    return { commands: [b.ms === undefined ? { action: 'step', n } : { action: 'step', n, ms: num(b, 'ms') }], timeout: STEP_TIMEOUT_MS };
  },
  'POST /cmd': (b) => ({ commands: [{ cmd: String(b.raw || b.cmd || '') }] }),
  'POST /eval': (b) => ({ commands: [{ action: 'eval', code: String(b.code || '') }] }),
};

// ---- local HTTP server -----------------------------------------------------------

const SECRET = crypto.randomBytes(16).toString('hex');
let PORT = 0;
const localBase = () => `http://127.0.0.1:${PORT}`;

function reply(res, status, body, type) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : JSON.stringify(body, null, 2) + '\n';
  res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (_) { reject(Object.assign(new Error('body must be JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function statusBody() {
  return {
    state: state.phase,
    error: state.error,
    bot: state.bot || identity.username,
    origin: ORIGIN,
    linkExpires: new Date(pairing.expires * 1000).toISOString(),
    connectedSec: state.connectedAt ? Math.round((Date.now() - state.connectedAt) / 1000) : null,
    lastEvent: state.lastEvent,
    next: {
      'starting': 'wait a moment, then GET /status again',
      'needs-register': 'GET /register, solve the puzzle, POST /register',
      'publishing': 'wait a moment, then GET /status again',
      'asking': 'the player has to click Allow in the game; poll GET /status every few seconds',
      'connected': 'GET /screenshot.png, then act (POST /click, /key, /type ...)',
      'closed': 'start again with a new link from the player',
      'failed': 'read "error"; start again with a new link from the player',
    }[state.phase],
  };
}

async function handle(req, res) {
  // Only this machine, only with the secret, only under our own Host: a web
  // page in the user's browser can make requests to 127.0.0.1 (and DNS
  // rebinding can make them look same-origin), but it cannot know the secret
  // and cannot forge the Host header.
  if (req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) {
    return reply(res, 403, { error: 'wrong Host' });
  }
  const url = new URL(req.url, localBase());
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${SECRET}` && url.searchParams.get('key') !== SECRET) {
    return reply(res, 401, { error: 'missing or wrong key: send  Authorization: Bearer <key from the READY line>' });
  }
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /status') return reply(res, 200, statusBody());
    if (route === 'GET /register') {
      if (!registration) return reply(res, 409, { error: 'no registration pending', state: state.phase });
      return reply(res, 200, {
        puzzle: registration.challenge.puzzle,
        expires_at: registration.challenge.expires_at,
        how: 'POST /register with {"answer": "<your answer>", "username": "<4-30 chars, letters/digits/_, ending in bot>"}',
      });
    }
    if (route === 'POST /register') {
      if (!registration) return reply(res, 409, { error: 'no registration pending', state: state.phase });
      const b = await readBody(req);
      const r = await solveRegistration(String(b.answer || ''), String(b.username || identity.preferredName || ''));
      return reply(res, r.ok ? 200 : 400, r);
    }
    if (route === 'GET /screenshot.png' || route === 'GET /screenshot') {
      const [result] = await sendCommands([{ action: 'png' }]);
      if (!result.ok) return reply(res, 502, { error: result.error });
      const m = /^data:image\/png;base64,(.+)$/.exec(String(result.value || ''));
      if (!m) return reply(res, 502, { error: 'the page returned no PNG' });
      if (url.searchParams.get('format') === 'base64') return reply(res, 200, { png: m[1] });
      return reply(res, 200, Buffer.from(m[1], 'base64'), 'image/png');
    }
    if (route === 'POST /disconnect') {
      if (state.channel) {
        try { state.channel.send(JSON.stringify({ t: 'event', event: { type: 'bye' } })); } catch (_) {}
      }
      closed('this agent disconnected');
      reply(res, 200, { ok: true });
      // Closing the peer connection at once drops the queued bye before SCTP
      // sends it, and the page then waits out an ICE timeout to notice.
      setTimeout(() => {
        const done = () => process.exit(0);
        if (state.pc) state.pc.close().then(done, done); else done();
      }, 300);
      return;
    }
    const make = ROUTES[route];
    if (!make) {
      return reply(res, 404, { error: `no route ${route}`, routes: ['GET /status', 'GET /screenshot.png',
        'GET /register', 'POST /register', 'POST /disconnect', ...Object.keys(ROUTES)] });
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const plan = make(body);
    const results = await sendCommands(plan.commands, plan.timeout);
    const failed = results.find(r => !r.ok);
    if (failed) return reply(res, 422, { ok: false, error: failed.error });
    return reply(res, 200, results.length === 1 ? { ok: true, value: results[0].value } : { ok: true });
  } catch (err) {
    return reply(res, err.status || 500, { error: String(err && err.message || err) });
  }
}

function listen() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { handle(req, res); });
    server.on('error', reject);
    server.listen(Number(flag('port')) || 0, '127.0.0.1', () => {
      PORT = server.address().port;
      resolve(server);
    });
  });
}

(async () => {
  await listen();
  say('READY', `${localBase()} key=${SECRET}`);
  say('INFO', `wine-agent ${VERSION}; pairing with ${ORIGIN}; link expires ${new Date(pairing.expires * 1000).toISOString()}`);
  if (flag('name') && !identity.username) {
    // A name chosen up front saves the agent one decision during registration.
    identity.preferredName = flag('name');
  }
  try {
    await connect();
  } catch (err) {
    state.phase = 'failed';
    state.error = String(err && err.message || err);
    say('FAILED', state.error);
  }
})();
