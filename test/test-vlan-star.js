#!/usr/bin/env node
// lib/vlan-star.js + lib/vlan-room.js — the star room, without a browser.
//
//   node test/test-vlan-star.js
//
// WebRTC and the signaling service are the only parts that need a browser,
// and neither decides anything here: they introduce two peers and carry
// bytes. So they are replaced by an in-memory directory (presence + offers)
// and a pair of cross-wired links, and everything that IS a decision runs for
// real -- who owns the room, which seat each joiner gets, which link a frame
// leaves on, what happens when someone leaves, and the probe that says
// whether this machine's game is serving.
//
//      alex (owner .1)
//       /          \
//   sam .2 ------- kim .3      sam -> kim goes through alex

'use strict';

const assert = require('assert');
const { Wire } = require('../lib/vlan-wire');
const star = require('../lib/vlan-star');
const { openRoom, hostedRooms, chooseOwner } = require('../lib/vlan-room');

let failures = 0;
async function check(what, fn) {
  try {
    await fn();
    console.log(`PASS  ${what}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${what}\n      ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n      ') : err}`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, what, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

// ---- stand-ins ----------------------------------------------------------

// A cross-wired pair: what one side sends, the other receives. Closing one
// end is the other end's disconnect, as a closed tab is.
class PairLink extends Wire {
  send(bytes) {
    if (this.closed) return false;
    this.sentFrames++;
    this.other.deliver(bytes);
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.other.closed = true;
    if (typeof this.other.onClosed === 'function') this.other.onClosed('channel-closed');
  }
}
function linkPair() {
  const a = new PairLink();
  const b = new PairLink();
  a.other = b; b.other = a;
  return [a, b];
}

// Presence and inboxes, shared by every FakeNet in one test.
class Directory {
  constructor() { this.records = new Map(); this.offers = []; this.clock = 0; }
}

class FakeNet {
  constructor(dir, userId, name) {
    Object.assign(this, { dir, userId, name, role: null, address: null, hosting: null, _left: false });
    this._announce();
  }
  _announce() {
    if (this._left) return;
    this.dir.records.set(this.userId, {
      userId: this.userId, name: this.name, role: this.role, address: this.address,
      hosting: this.hosting, updatedAt: ++this.dir.clock,
    });
  }
  async peers() {
    return Array.from(this.dir.records.values()).filter(r => r.userId !== this.userId)
      .map(r => Object.assign({}, r));
  }
  async setRole(role, address) { this.role = role; if (address !== undefined) this.address = address; this._announce(); }
  async setHosting(h) { this.hosting = h || null; this._announce(); }
  async leave() { this._left = true; this.dir.records.delete(this.userId); }

  connect(peerId, opts) {
    return new Promise((resolve, reject) => {
      const offer = { from: this.userId, to: peerId, resolve };
      this.dir.offers.push(offer);
      setTimeout(() => {
        const i = this.dir.offers.indexOf(offer);
        if (i >= 0) { this.dir.offers.splice(i, 1); reject(new Error('vlan: the peer did not answer')); }
      }, (opts && opts.timeoutMs) || 1000);
    });
  }

  async accept(opts) {
    const end = Date.now() + opts.timeoutMs;
    while (Date.now() < end) {
      if (this._left) throw new Error('vlan: left the segment');
      const i = this.dir.offers.findIndex(o => o.to === this.userId);
      if (i >= 0) {
        const offer = this.dir.offers[i];
        const peer = this.dir.records.get(offer.from);
        this.dir.offers.splice(i, 1);
        if (!peer || (opts.skip && opts.skip(peer))) continue;
        const extra = opts.answerExtra ? opts.answerExtra(peer) : null;
        const [mine, theirs] = linkPair();
        offer.resolve({ wire: theirs, peer: this.dir.records.get(this.userId), answer: Object.assign({ role: 'answer' }, extra) });
        return { wire: mine, peer, extra };
      }
      await sleep(5);
    }
    throw new Error('vlan: nobody tried to connect');
  }
}

function fakeRtc(dir, userId, name) {
  return {
    joinNetwork: async () => new FakeNet(dir, userId, name),
    peekNetwork: async () => ({
      userId,
      peers: Array.from(dir.records.values()).filter(r => r.userId !== userId).map(r => Object.assign({}, r)),
    }),
  };
}

function open(dir, userId, name, extra) {
  const events = [];
  const opts = Object.assign({
    rtc: fakeRtc(dir, userId, name), settleMs: 20, connectTimeoutMs: 200,
    onEvent: (type, detail) => events.push(Object.assign({ type }, detail)),
  }, extra);
  return openRoom(opts).then(room => { room.events = events; return room; });
}

const ip = star.ipValue;
function dgram(src, dst, payload) {
  return star.datagram(ip(src), 5000, dst === 'broadcast' ? 0xFFFFFFFF : ip(dst), 27910,
    star.latin1(payload || 'x'));
}
function drain(wire) {
  const out = [];
  for (let f = wire.peek(); f; f = wire.peek()) { out.push(f); wire.commit(); }
  return out;
}
const payloadOf = f => Buffer.from(f.subarray(28)).toString('latin1');

// ---- the frame is the address -------------------------------------------

async function main() {
  await check('a frame\'s destination is read from its own header', () => {
    assert.strictEqual(star.frameDestination(dgram('10.0.0.2', '10.0.0.3')), ip('10.0.0.3'));
    assert.strictEqual(star.frameDestination(dgram('10.0.0.2', 'broadcast')), star.BROADCAST);
    assert.strictEqual(star.frameDestination(dgram('10.0.0.2', '10.0.0.255')), star.BROADCAST);
    // DirectPlay's header keeps the destination at +12, -1 for everyone.
    const dpl = new Uint8Array(28);
    const dv = new DataView(dpl.buffer);
    dv.setUint32(0, 0x314C5044, true);
    dv.setUint32(12, ip('10.0.0.4'), true);
    assert.strictEqual(star.frameDestination(dpl), ip('10.0.0.4'));
    dv.setUint32(12, 0xFFFFFFFF, true);
    assert.strictEqual(star.frameDestination(dpl), star.BROADCAST);
    // Anything unreadable floods: every receiver's WAT filters by address.
    assert.strictEqual(star.frameDestination(new Uint8Array(40)), null);
  });

  // ---- one room, three people ---------------------------------------------

  const dir = new Directory();
  const alex = await open(dir, 'u1', 'alex');
  const sam = await open(dir, 'u2', 'sam');
  const kim = await open(dir, 'u3', 'kim');

  await check('the first person on the channel owns the room, at 10.0.0.1', () => {
    assert.strictEqual(alex.role, 'owner');
    assert.strictEqual(alex.address, '10.0.0.1');
    assert.strictEqual(dir.records.get('u1').role, 'owner');
  });

  await check('everyone after joins it, and the owner hands out 2, 3 in order', () => {
    assert.strictEqual(sam.role, 'member');
    assert.strictEqual(sam.address, '10.0.0.2');
    assert.strictEqual(kim.address, '10.0.0.3');
    assert.strictEqual(alex.memberCount, 2);
    assert.deepStrictEqual(alex.events.filter(e => e.type === 'joined').map(e => [e.name, e.address]),
      [['sam', '10.0.0.2'], ['kim', '10.0.0.3']]);
  });

  await check('a frame from one member to another goes through the owner, and only to them', () => {
    assert.strictEqual(sam.wire.send(dgram('10.0.0.2', '10.0.0.3', 'hi kim')), true);
    assert.deepStrictEqual(drain(kim.wire).map(payloadOf), ['hi kim']);
    assert.strictEqual(drain(alex.wire).length, 0, 'the owner\'s own guest saw a frame not addressed to it');
    assert.strictEqual(alex.wire.forwardedFrames, 1);
  });

  await check('a broadcast reaches every other seat, never back to its sender', () => {
    sam.wire.send(dgram('10.0.0.2', 'broadcast', 'info 34'));
    assert.deepStrictEqual(drain(alex.wire).map(payloadOf), ['info 34']);
    assert.deepStrictEqual(drain(kim.wire).map(payloadOf), ['info 34']);
    assert.strictEqual(drain(sam.wire).length, 0);
    alex.wire.send(dgram('10.0.0.1', 'broadcast', 'from alex'));
    assert.deepStrictEqual(drain(sam.wire).map(payloadOf), ['from alex']);
    assert.deepStrictEqual(drain(kim.wire).map(payloadOf), ['from alex']);
    assert.strictEqual(drain(alex.wire).length, 0);
  });

  await check('the owner\'s own frames leave on the one link they are for', () => {
    alex.wire.send(dgram('10.0.0.1', '10.0.0.2', 'for sam'));
    assert.deepStrictEqual(drain(sam.wire).map(payloadOf), ['for sam']);
    assert.strictEqual(drain(kim.wire).length, 0);
    // A seat nobody holds: the frame goes nowhere, as on a real LAN.
    assert.strictEqual(alex.wire.send(dgram('10.0.0.1', '10.0.0.9', 'nobody')), true);
  });

  await check('a frame back to the owner reaches the owner\'s guest', () => {
    kim.wire.send(dgram('10.0.0.3', '10.0.0.1', 'to alex'));
    assert.deepStrictEqual(drain(alex.wire).map(payloadOf), ['to alex']);
    assert.strictEqual(drain(sam.wire).length, 0);
  });

  // ---- is this game hosting? ----------------------------------------------

  // A guest that behaves like Quake II's SVC_Info: answer an "info" query on
  // the server port with the status line, but only while `serving`.
  let serving = true;
  function answerProbes(room) {
    for (const f of drain(room.wire)) {
      const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
      if (!serving || dv.getUint32(20, true) !== 27910 || !payloadOf(f).startsWith('\xff\xff\xff\xffinfo')) continue;
      room.wire.send(star.datagram(ip(room.address), 27910, dv.getUint32(8, true), dv.getUint32(12, true),
        star.latin1('\xff\xff\xff\xffinfo\n          noname    demo1  1/ 4\n')));
    }
  }
  const quakeProbe = { port: 27910, query: '\xff\xff\xff\xffinfo 34', label: '^\\xff{4}info\\n(.*)$' };

  await check('a game that answers a server query is published as hosting, with its status line', async () => {
    alex.startProbe(quakeProbe, 60000);
    answerProbes(alex);
    await until(() => dir.records.get('u1').hosting, 'the hosting record');
    assert.deepStrictEqual(dir.records.get('u1').hosting, { label: 'noname demo1 1/4' });
    assert.ok(alex.events.some(e => e.type === 'hosting' && e.hosting), 'no hosting event');
    // The answer went to the probe seat, which is nobody: it must not leave
    // on any link.
    assert.strictEqual(drain(sam.wire).length + drain(kim.wire).length, 0);
  });

  await check('someone about to launch sees that room offered, with its label', async () => {
    const offered = await hostedRooms({ rtc: fakeRtc(dir, 'u9', 'lee') });
    assert.deepStrictEqual(offered.map(p => [p.name, p.hosting.label]), [['alex', 'noname demo1 1/4']]);
    // The list names who looked, so a room link naming that account can be
    // told apart from a room that is not open.
    assert.strictEqual(offered.userId, 'u9');
  });

  await check('the owner looking never sees its own room, and is told who it is', async () => {
    const own = await hostedRooms({ rtc: fakeRtc(dir, 'u1', 'alex'), includeIdle: true });
    assert.ok(!own.some(p => p.userId === 'u1'), 'own room listed');
    assert.strictEqual(own.userId, 'u1');
  });

  await check('a game that stops answering stops being offered', async () => {
    serving = false;
    for (let i = 0; i < 4; i++) { alex.probe.ask(); answerProbes(alex); }
    await until(() => !dir.records.get('u1').hosting, 'the hosting record to clear');
    assert.deepStrictEqual(await hostedRooms({ rtc: fakeRtc(dir, 'u9', 'lee') }), []);
    serving = true;
  });

  // ---- people leave -------------------------------------------------------

  await check('a member leaving drops only their link, and frees their seat', async () => {
    sam.wire.link.close();
    await until(() => alex.memberCount === 1, 'the owner to drop sam');
    assert.ok(alex.events.some(e => e.type === 'left' && e.name === 'sam'));
    await sam.close();
    kim.wire.send(dgram('10.0.0.3', '10.0.0.1', 'still here'));
    assert.deepStrictEqual(drain(alex.wire).map(payloadOf), ['still here']);
    const lee = await open(dir, 'u4', 'lee');
    assert.strictEqual(lee.address, '10.0.0.2', 'the freed seat was not reused');
    await lee.close();
  });

  await check('the owner leaving ends the room for every member', async () => {
    await alex.close();
    await until(() => kim.events.some(e => e.type === 'closed'), 'kim to hear the room closed');
    assert.match(kim.events.find(e => e.type === 'closed').message, /alex closed the room/);
    await kim.close();
  });

  // ---- nobody is in charge -------------------------------------------------

  await check('two people opening an empty channel at once end up in ONE room', async () => {
    const d = new Directory();
    const [a, b] = await Promise.all([open(d, 'u5', 'ana'), open(d, 'u6', 'ben')]);
    const owners = [a, b].filter(r => r.role === 'owner');
    assert.strictEqual(owners.length, 1, `roles: ${a.role}, ${b.role}`);
    assert.strictEqual(owners[0].net.userId, 'u5', 'the lower user id should keep the room');
    assert.strictEqual(b.address, '10.0.0.2');
    await b.close(); await a.close();
  });

  await check('"Start my own room" opens a second room beside a serving one', async () => {
    const d = new Directory();
    const a = await open(d, 'u1', 'ana');
    const b = await open(d, 'u2', 'ben', { ownRoom: true });
    assert.strictEqual(b.role, 'owner', 'ben asked for his own room');
    assert.strictEqual(b.address, '10.0.0.1');
    assert.strictEqual(a.wire.memberCount, 0, 'nobody joined ana');
    const c = await open(d, 'u3', 'cy', { preferOwner: 'u2' });
    assert.strictEqual(c.role, 'member');
    assert.strictEqual(c.owner.userId, 'u2', 'a pick from the list reaches that room, not the older one');
    assert.strictEqual(b.wire.memberCount, 1);
    await c.close(); await b.close(); await a.close();
  });

  await check('an owner that never answers (a closed tab) is passed over for a room of our own', async () => {
    const d = new Directory();
    d.records.set('u0', { userId: 'u0', name: 'ghost', role: 'owner', address: '10.0.0.1', updatedAt: 1 });
    const r = await open(d, 'u7', 'zoe', { connectTimeoutMs: 30 });
    assert.strictEqual(r.role, 'owner');
    assert.strictEqual(r.address, '10.0.0.1');
    await r.close();
  });

  await check('the Join card\'s pick wins over the automatic choice', () => {
    const peers = [
      { userId: 'a', role: 'owner', address: '10.0.0.1', hosting: { label: 'x' }, updatedAt: 9 },
      { userId: 'b', role: 'owner', address: '10.0.0.1', hosting: null, updatedAt: 10 },
      { userId: 'c', role: 'member', address: '10.0.0.2', updatedAt: 11 },
    ];
    assert.strictEqual(chooseOwner(peers).userId, 'a', 'a serving owner should beat a fresher idle one');
    assert.strictEqual(chooseOwner(peers, 'b').userId, 'b');
    assert.strictEqual(chooseOwner([peers[2]]), null);
  });

  console.log(failures ? `test-vlan-star: ${failures} FAILED` : 'test-vlan-star: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
