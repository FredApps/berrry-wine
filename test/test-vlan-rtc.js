#!/usr/bin/env node
// lib/vlan-rtc.js — the parts that do not need a browser.
//
// The RTCPeerConnection handshake itself needs a browser, so joinRoom is not
// exercised here. Everything it depends on is: the room secret and the key
// derived from it, the sealed envelope that keeps a world-readable record
// opaque, the signaling client against a real dev server, and the wire
// contract against a stand-in channel.

'use strict';

const assert = require('assert');
const { createServer } = require('../tools/dev-server');
const rtc = require('../lib/vlan-rtc');

const { RtcWire, SignalingClient, newRoomSecret, roomKeyFor, _internals } = rtc;
const { sealed, opened, cryptoKeyFor } = _internals;

let failures = 0;
async function check(what, fn) {
  try {
    await fn();
    console.log(`PASS  ${what}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${what}\n      ${err && err.message}`);
  }
}

// A stand-in for RTCDataChannel: enough surface for RtcWire, and observable.
class FakeChannel {
  constructor() {
    this.readyState = 'open';
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
    this.binaryType = '';
  }
  send(bytes) {
    if (this.throwOnSend) throw new Error('channel is gone');
    this.sent.push(Uint8Array.from(bytes));
  }
  close() { this.closed = true; this.readyState = 'closed'; }
  // Test helper: pretend the far side hung up without a goodbye.
  hangUp() { this.readyState = 'closed'; if (this.onclose) this.onclose(); }
  // Test helper: pretend the far side sent something.
  arrive(bytes) { if (this.onmessage) this.onmessage({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); }
}

// A stand-in for RTCPeerConnection: only the part RtcWire watches. ICE state
// is the only thing that reports a peer which vanished without closing its
// channel -- a shut laptop, a tab killed, Wi-Fi gone -- so it has to be
// drivable from a test.
class FakePeerConnection {
  constructor() {
    this.connectionState = 'connected';
    this._listeners = [];
  }
  addEventListener(type, fn) { if (type === 'connectionstatechange') this._listeners.push(fn); }
  set(state) {
    this.connectionState = state;
    for (const fn of this._listeners) fn();
  }
}

function frame(n) {
  const b = new Uint8Array(28 + n);
  new DataView(b.buffer).setUint32(24, n, true);
  return b;
}

async function main() {
  const server = createServer({ quiet: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ---- room identity ------------------------------------------------
    await check('two room secrets differ', () => {
      assert.notStrictEqual(newRoomSecret(), newRoomSecret());
    });

    const secret = newRoomSecret();
    await check('the room key is stable for a secret', async () => {
      assert.strictEqual(await roomKeyFor(secret), await roomKeyFor(secret));
    });

    await check('the room key does not contain the secret', async () => {
      const key = await roomKeyFor(secret);
      assert.ok(!key.includes(secret),
        'the signaling key must not leak the secret that decrypts it');
    });

    await check('different secrets give different room keys', async () => {
      assert.notStrictEqual(await roomKeyFor(secret), await roomKeyFor(newRoomSecret()));
    });

    // ---- the sealed envelope -------------------------------------------
    const key = await cryptoKeyFor(secret);
    await check('a sealed record round-trips', async () => {
      const env = await sealed(key, { role: 'offer', sdp: 'v=0...' });
      const back = await opened(key, env);
      assert.strictEqual(back.role, 'offer');
      assert.strictEqual(back.sdp, 'v=0...');
    });

    await check('the sealed record does not carry its plaintext', async () => {
      const env = await sealed(key, { role: 'offer', sdp: 'CANARY-SDP-VALUE' });
      assert.ok(!JSON.stringify(env).includes('CANARY-SDP-VALUE'));
      assert.ok(!JSON.stringify(env).includes('offer'));
    });

    await check('the wrong secret cannot open it', async () => {
      const env = await sealed(key, { role: 'offer', sdp: 'v=0...' });
      const other = await cryptoKeyFor(newRoomSecret());
      assert.strictEqual(await opened(other, env), null);
    });

    await check('a tampered record is refused, not returned', async () => {
      const env = await sealed(key, { role: 'offer', sdp: 'v=0...' });
      const bad = Object.assign({}, env, { ct: env.ct.slice(0, -4) + 'AAAA' });
      assert.strictEqual(await opened(key, bad), null);
    });

    await check('a record that is not an envelope is refused', async () => {
      assert.strictEqual(await opened(key, null), null);
      assert.strictEqual(await opened(key, { nope: 1 }), null);
    });

    await check('two seals of the same value differ', async () => {
      const a = await sealed(key, { x: 1 });
      const b = await sealed(key, { x: 1 });
      assert.notStrictEqual(a.ct, b.ct, 'a repeated nonce would leak equality');
    });

    // ---- the insecure-context guarantee ---------------------------------
    //
    // The X25519 agreement itself, and the onlooker who cannot read a record
    // addressed to someone else, are covered against the real signaling server
    // further down ("an offer left for a peer is readable only by that peer").
    // What is checked here is the part that has no other home: that none of it
    // needs WebCrypto.
    //
    // This is the reason lib/vendor/tweetnacl.js exists. A phone loading the
    // dev server over http://<lan-ip> gets no crypto.subtle at all -- measured
    // on that origin: RTCPeerConnection and createDataChannel work,
    // getRandomValues works, crypto.subtle is undefined. So the whole crypto
    // path has to run without it, and the only honest way to assert that is to
    // take it away and load the module again from scratch.
    await check('the crypto path works with crypto.subtle removed', async () => {
      const realSubtle = globalThis.crypto.subtle;
      const path = require.resolve('../lib/vlan-rtc');
      const naclPath = require.resolve('../lib/vendor/tweetnacl');
      try {
        Object.defineProperty(globalThis.crypto, 'subtle',
          { value: undefined, configurable: true });
        delete require.cache[path];
        delete require.cache[naclPath];
        const fresh = require('../lib/vlan-rtc');
        assert.strictEqual(globalThis.crypto.subtle, undefined, 'subtle still present');
        const i = fresh._internals;
        const k = await i.cryptoKeyFor('a-secret');
        const env = await i.sealed(k, { sdp: 'NO-SUBTLE' });
        assert.deepStrictEqual(await i.opened(k, env), { sdp: 'NO-SUBTLE' });
        const p = await i.newIdentity();
        const q = await i.newIdentity();
        const sealedForQ = await i.sealed(await i.sharedKeyWith(p, q.publicKey), { sdp: 'X' });
        assert.deepStrictEqual(
          await i.opened(await i.sharedKeyWith(q, p.publicKey), sealedForQ), { sdp: 'X' });
        // And the record keys, which are hashes: derived without subtle too.
        assert.match(await fresh.roomKeyFor('a-secret'), /^vln-signal-[\w-]{22}$/);
      } finally {
        Object.defineProperty(globalThis.crypto, 'subtle',
          { value: realSubtle, configurable: true });
        delete require.cache[path];
        delete require.cache[naclPath];
      }
    });

    // ---- signaling against the real dev server --------------------------
    // Each client gets its own cookie jar, which is what makes them two users.
    function client() {
      const jar = { cookie: null };
      const c = new SignalingClient(base);
      const origFetch = globalThis.fetch;
      c._json = async (method, url, body) => {
        const headers = {};
        if (jar.cookie) headers.cookie = jar.cookie;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await origFetch(base + url, {
          method, headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const sc = res.headers.get('set-cookie');
        if (sc) jar.cookie = sc.split(';')[0];
        if (!res.ok) return null;
        return res.json();
      };
      return c;
    }

    const alice = client();
    const bob = client();
    const roomKey = await roomKeyFor(secret);

    await check('a peer publishes and the other discovers it', async () => {
      const me = await alice.whoami();
      const bobId = (await bob.whoami()).id;
      await alice.publish(roomKey, await sealed(key, { role: 'offer', sdp: 'A' }));
      const found = await bob.publishers(roomKey);
      const others = found.users.filter(u => u.userId !== bobId);
      assert.strictEqual(others.length, 1);
      assert.strictEqual(others[0].userId, me.id);
    });

    await check('the discovered record decrypts with the room secret', async () => {
      const me = await alice.whoami();
      const rec = await bob.read(me.id, roomKey);
      const msg = await opened(key, rec.value);
      assert.strictEqual(msg.sdp, 'A');
    });

    await check('someone without the secret sees only ciphertext', async () => {
      const me = await alice.whoami();
      const rec = await bob.read(me.id, roomKey);
      const outsider = await cryptoKeyFor('a-guess');
      assert.strictEqual(await opened(outsider, rec.value), null);
    });

    await check('withdrawing removes the peer from discovery', async () => {
      await alice.withdraw(roomKey);
      const found = await bob.publishers(roomKey);
      const me = await alice.whoami();
      assert.ok(!found.users.some(u => u.userId === me.id));
    });

    // ---- scopes: one network, then channels, then rooms -----------------
    const { scopeFor, signalKeyFor } = rtc;

    await check('the default scope is one shared network', () => {
      assert.strictEqual(scopeFor({}), 'net:default');
      assert.strictEqual(scopeFor(), 'net:default');
    });

    await check('a channel scope names the executable', () => {
      assert.strictEqual(scopeFor({ exe: 'lwwin.exe' }), 'net:default/exe:lwwin.exe');
    });

    await check('the same program from two paths is one channel', () => {
      assert.strictEqual(
        scopeFor({ exe: 'test/binaries/candidates/liquid-war/LW5/lwwin.exe' }),
        scopeFor({ exe: 'LWWIN.EXE' }));
    });

    await check('a room is a subdivision of a channel', () => {
      assert.strictEqual(scopeFor({ exe: 'lwwin.exe', room: 'r1' }),
        'net:default/exe:lwwin.exe/room:r1');
    });

    await check('two programs do not share a signaling key', async () => {
      assert.notStrictEqual(
        await signalKeyFor(scopeFor({ exe: 'lwwin.exe' })),
        await signalKeyFor(scopeFor({ exe: 'doom.exe' })));
    });

    await check('a scope with no secret still yields a usable key', async () => {
      const k = await signalKeyFor(scopeFor({ exe: 'lwwin.exe' }));
      assert.ok(k.startsWith('vln-signal-'));
      assert.ok(k.length > 12);
    });

    await check('a secret changes the key of the same scope', async () => {
      const scope = scopeFor({ exe: 'lwwin.exe' });
      assert.notStrictEqual(await signalKeyFor(scope), await signalKeyFor(scope, secret));
    });

    await check('the key of a shared network is computable by anyone', async () => {
      // Not a defect — it is the definition of an open network, and the
      // design doc records what it costs. Asserted so a later change that
      // makes it secret is a deliberate one.
      assert.strictEqual(await signalKeyFor(scopeFor({})), await signalKeyFor('net:default'));
    });

    // ---- presence, addresses, and directed offers -----------------------
    const {
      joinNetwork, inboxKeyFor, pickAddress, seatAddress, claimLoses, MAX_SEATS,
      PRESENCE_TTL_MS,
    } = rtc;
    const { newIdentity, sharedKeyWith } = _internals;

    // The host's address is the one a person types into a 1998 dialog, so an
    // empty room must always produce the same one -- "10.1" only works
    // because the first arrival is 10.0.0.1 every single time.
    await check('the first seat in an empty room is always the host address', () => {
      assert.strictEqual(pickAddress([]), '10.0.0.1');
      assert.strictEqual(seatAddress(1), '10.0.0.1');
    });

    await check('seats are handed out in order and stay dense', () => {
      const taken = [];
      for (let i = 0; i < 5; i++) taken.push(pickAddress(taken));
      assert.deepStrictEqual(taken,
        ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5']);
    });

    // A seat freed by someone leaving is reused rather than skipped, so the
    // host address comes back when the host does.
    await check('a freed seat is reused, including seat 1', () => {
      assert.strictEqual(pickAddress(['10.0.0.2', '10.0.0.3']), '10.0.0.1');
      assert.strictEqual(pickAddress(['10.0.0.1', '10.0.0.3']), '10.0.0.2');
    });

    await check('a claimed seat is not handed out again', () => {
      const taken = [];
      for (let i = 0; i < 200; i++) taken.push(pickAddress(taken));
      assert.strictEqual(new Set(taken).size, taken.length);
    });

    // Refusing is the only safe answer: a duplicate address makes two peers
    // answer to one name, and the switch has no way to tell them apart.
    await check('a full segment refuses rather than duplicating a seat', () => {
      const full = [];
      for (let seat = 1; seat <= MAX_SEATS; seat++) full.push(seatAddress(seat));
      assert.throws(() => pickAddress(full), /no free address/);
    });

    await check('exactly one side yields when two claim the same address', () => {
      const a = { address: '10.0.0.5', userId: 'aaa' };
      const b = { address: '10.0.0.5', userId: 'bbb' };
      // Both peers evaluate the same pair and must not both move, or both stay.
      assert.strictEqual(claimLoses(a, b) !== claimLoses(b, a), true);
    });

    await check('different addresses never collide', () => {
      assert.strictEqual(
        claimLoses({ address: '10.0.0.5', userId: 'zzz' },
                   { address: '10.0.0.6', userId: 'aaa' }), false);
    });

    await check('an unaddressed claim does not collide with anything', () => {
      assert.strictEqual(claimLoses({ userId: 'z' }, { address: '10.0.0.5', userId: 'a' }), false);
    });

    await check('a peer inbox key is specific to the recipient', async () => {
      const scope = scopeFor({ exe: 'lwwin.exe' });
      assert.notStrictEqual(await inboxKeyFor(scope, 'user-a'), await inboxKeyFor(scope, 'user-b'));
      assert.strictEqual(await inboxKeyFor(scope, 'user-a'), await inboxKeyFor(scope, 'user-a'));
    });

    await check('an inbox is not the presence key', async () => {
      const scope = scopeFor({});
      assert.notStrictEqual(await inboxKeyFor(scope, 'user-a'), await signalKeyFor(scope));
    });

    // A network needs a signaling client bound to its own cookie jar, which
    // is what makes each one a distinct user against the dev server.
    const netFor = (name) => joinNetwork({
      exe: 'lwwin.exe', name, signaling: client(),
    });

    let alpha = await netFor('alpha');
    const beta = await netFor('beta');

    await check('joining claims a seat on the segment', () => {
      assert.ok(/^10\.0\.0\.\d+$/.test(alpha.address), alpha.address);
    });

    // Whoever got there first is the host, and the host is 10.0.0.1 — the
    // address every game's connect box is going to be handed.
    await check('one of the two peers holds the host address', () => {
      assert.ok([alpha.address, beta.address].includes('10.0.0.1'),
        `${alpha.address} / ${beta.address}`);
    });

    await check('two peers on one segment get different addresses', () => {
      assert.notStrictEqual(alpha.address, beta.address);
    });

    await check('each peer sees the other, with address and key', async () => {
      const seen = await alpha.peers();
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].name, 'beta');
      assert.strictEqual(seen[0].address, beta.address);
      assert.strictEqual(seen[0].publicKey, beta.identity.publicKey);
    });

    await check('a peer does not list itself', async () => {
      const seen = await alpha.peers();
      assert.ok(!seen.some(p => p.userId === alpha.userId));
    });

    await check('presence carries no SDP', async () => {
      const seen = await alpha.peers();
      assert.ok(!('sdp' in seen[0]), 'an address exchange must not ride on presence');
    });

    await check('presence liveness comes from the store, not the record', async () => {
      // Berrry stamps updated_at in the publisher list; a single read
      // answers the bare value, so the list is where the clock comes from.
      const list = await alpha.signaling.publishers(beta.presenceKey);
      const rec = list.users.find(u => u.userId === beta.userId);
      assert.ok(rec && rec.updatedAt, 'the store must stamp the record');
      assert.ok(!('at' in rec.value), 'a client clock must not be in the body');
      assert.ok(Number.isFinite(Date.parse(rec.updatedAt)));
    });

    await check('a stale peer drops off the segment', async () => {
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + PRESENCE_TTL_MS + 1000;
        assert.strictEqual((await alpha.peers()).length, 0);
      } finally {
        Date.now = realNow;
      }
    });

    await check('peers on different channels do not see each other', async () => {
      const other = await joinNetwork({ exe: 'doom.exe', name: 'gamma', signaling: client() });
      try {
        assert.strictEqual((await other.peers()).length, 0);
        assert.ok(!(await alpha.peers()).some(p => p.name === 'gamma'));
      } finally {
        await other.leave();
      }
    });

    await check('an offer left for a peer is readable only by that peer', async () => {
      // Alpha seals an offer to beta the way connect() does.
      const [betaSeen] = await alpha.peers();
      const key = await sharedKeyWith(alpha.identity, betaSeen.publicKey);
      const inbox = await inboxKeyFor(alpha.scope, beta.userId);
      // Through _post, the way connect() does it, so the record is tracked
      // as ours to withdraw later.
      await alpha._post(inbox, Object.assign(
        { from: alpha.userId, publicKey: alpha.identity.publicKey },
        await sealed(key, { role: 'offer', sdp: 'v=0 CANDIDATE-SECRET' })));

      // Beta, holding the matching private key, can read it.
      const [alphaSeen] = await beta.peers();
      const betaKey = await sharedKeyWith(beta.identity, alphaSeen.publicKey);
      const got = await beta._readInbox(inbox, alphaSeen, betaKey, 'offer');
      assert.ok(got, 'the intended recipient must be able to read it');
      assert.strictEqual(got.sdp, 'v=0 CANDIDATE-SECRET');

      // An onlooker who can read the record cannot read the SDP.
      const onlooker = await newIdentity();
      const wrongKey = await sharedKeyWith(onlooker, alphaSeen.publicKey);
      const raw = await beta.signaling.read(alpha.userId, inbox);
      assert.ok(raw && raw.value, 'the record itself is public');
      assert.ok(!JSON.stringify(raw.value).includes('CANDIDATE-SECRET'));
      assert.strictEqual(await opened(wrongKey, raw.value), null);
    });

    await check('a record whose author is forged is ignored', async () => {
      const [alphaSeen] = await beta.peers();
      const betaKey = await sharedKeyWith(beta.identity, alphaSeen.publicKey);
      const inbox = await inboxKeyFor(alpha.scope, beta.userId);
      // Gamma publishes into beta's inbox but claims to be alpha.
      const gamma = client();
      await gamma._json('POST', `/api/data/${encodeURIComponent(inbox)}?visibility=public`,
        Object.assign({ from: alpha.userId, publicKey: alphaSeen.publicKey },
          await sealed(betaKey, { role: 'offer', sdp: 'IMPOSTOR' })));
      const got = await beta._readInbox(inbox, alphaSeen, betaKey, 'offer');
      assert.ok(!got || got.sdp !== 'IMPOSTOR',
        'a record must not be trusted when its author is not who it names');
    });

    await check('an inbox record belongs to its sender, not the recipient', async () => {
      // The point of the model: to reach beta, alpha publishes ALPHA's record
      // under a key derived from BETA's id. Beta owns nothing there and can
      // delete nothing there — so cleanup has to be done by the sender.
      const inbox = await inboxKeyFor(alpha.scope, beta.userId);
      const owners = await beta.signaling.publishers(inbox);
      assert.ok(owners.users.some(u => u.userId === alpha.userId),
        'the record under beta\'s inbox key must be owned by alpha');
      assert.ok(!owners.users.some(u => u.userId === beta.userId),
        'beta must not own anything under its own inbox key');

      // Beta deleting "its" inbox does nothing, because there is nothing of
      // beta's to delete. An earlier version cleaned up this way and left
      // every SDP it had ever sent published.
      await beta.signaling.withdraw(inbox);
      const after = await beta.signaling.publishers(inbox);
      assert.ok(after.users.some(u => u.userId === alpha.userId),
        'a recipient must not be able to remove a sender\'s record');
    });

    await check('leaving withdraws what this peer posted to others', async () => {
      const inbox = await inboxKeyFor(alpha.scope, beta.userId);
      const before = await beta.signaling.publishers(inbox);
      assert.ok(before.users.some(u => u.userId === alpha.userId), 'precondition');
      await alpha.leave();
      const after = await beta.signaling.publishers(inbox);
      assert.ok(!after.users.some(u => u.userId === alpha.userId),
        'leaving must retract the offers this peer left in other inboxes');
      // Rejoin so the checks after this one still have a live alpha.
      alpha = await netFor('alpha');
    });

    await check('leaving withdraws presence', async () => {
      await beta.leave();
      assert.strictEqual((await alpha.peers()).length, 0);
    });

    await alpha.leave();

    // ---- lobby role assignment -------------------------------------------
    // The rule that keeps two people clicking each other at the same moment
    // from both offering and both waiting. It needs no DOM, so it is tested
    // here rather than left to a browser nobody runs headless.
    const lobby = require('../lib/vlan-lobby');
    const { roleFor, INVITE_PREFIX } = lobby;

    await check('no invite means no role', () => {
      assert.strictEqual(roleFor('aaa', { userId: 'bbb', status: 'available' }), null);
    });

    await check('being invited gives a role', () => {
      assert.ok(roleFor('aaa', { userId: 'bbb', status: INVITE_PREFIX + 'aaa' }));
    });

    await check('inviting gives a role', () => {
      assert.ok(roleFor('aaa', { userId: 'bbb', status: 'available', invitedByMe: true }));
    });

    await check('an invite aimed at someone else is not ours', () => {
      assert.strictEqual(
        roleFor('aaa', { userId: 'bbb', status: INVITE_PREFIX + 'ccc' }), null);
    });

    await check('exactly one side offers, whoever clicked', () => {
      // Every combination of who clicked: one-sided either way, and both at
      // once. In all of them the pair must agree on opposite roles.
      const cases = [
        [{ userId: 'bbb', status: INVITE_PREFIX + 'aaa' }, { userId: 'aaa', status: 'available', invitedByMe: true }],
        [{ userId: 'bbb', status: 'available', invitedByMe: true }, { userId: 'aaa', status: INVITE_PREFIX + 'bbb' }],
        [{ userId: 'bbb', status: INVITE_PREFIX + 'aaa', invitedByMe: true },
         { userId: 'aaa', status: INVITE_PREFIX + 'bbb', invitedByMe: true }],
      ];
      for (const [peerFromA, peerFromB] of cases) {
        const a = roleFor('aaa', peerFromA);
        const b = roleFor('bbb', peerFromB);
        assert.ok(a && b, 'both sides must find a role');
        assert.notStrictEqual(a, b, `glare: both chose ${a}`);
      }
    });

    await check('the role does not depend on who asked first', () => {
      const asA = roleFor('aaa', { userId: 'bbb', status: INVITE_PREFIX + 'aaa' });
      const asAInviting = roleFor('aaa', { userId: 'bbb', status: 'available', invitedByMe: true });
      assert.strictEqual(asA, asAInviting);
    });

    // ---- the wire contract ----------------------------------------------
    await check('an inbound message becomes a peekable frame', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      assert.strictEqual(wire.peek(), null);
      ch.arrive(frame(4));
      assert.strictEqual(wire.pending, 1);
      assert.strictEqual(wire.peek().length, 32);
      wire.commit();
      assert.strictEqual(wire.pending, 0);
    });

    await check('the channel is put in binary mode', () => {
      const ch = new FakeChannel();
      new RtcWire(ch);
      assert.strictEqual(ch.binaryType, 'arraybuffer');
    });

    await check('a frame sent reaches the channel', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      assert.strictEqual(wire.send(frame(2)), true);
      assert.strictEqual(ch.sent.length, 1);
      assert.strictEqual(wire.sentFrames, 1);
    });

    await check('a full channel refuses rather than buffering without bound', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      ch.bufferedAmount = 4 << 20;
      assert.strictEqual(wire.send(frame(2)), false);
      assert.strictEqual(ch.sent.length, 0);
    });

    await check('a closed channel refuses to send', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      ch.readyState = 'closed';
      assert.strictEqual(wire.send(frame(2)), false);
    });

    await check('a throwing channel refuses rather than propagating', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      ch.throwOnSend = true;
      assert.strictEqual(wire.send(frame(2)), false);
    });

    await check('a non-frame message is ignored, not delivered', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      if (ch.onmessage) ch.onmessage({ data: 'hello' });
      assert.strictEqual(wire.pending, 0);
    });

    await check('closing the wire closes the channel', () => {
      const ch = new FakeChannel();
      const wire = new RtcWire(ch);
      wire.close();
      assert.strictEqual(ch.closed, true);
      assert.strictEqual(wire.send(frame(1)), false);
    });

    // ---- answering offers -------------------------------------------------
    //
    // An offer outlives its author: a tab closed while waiting for an answer
    // leaves it in the inbox, and nobody else can withdraw it. The handshake
    // is faked here only far enough to tell a live offer from a dead one --
    // a live offerer opens the data channel once answered, a dead one never.
    {
      const made = [];
      class HandshakePC {
        constructor() {
          this.iceGatheringState = 'complete';
          this.connectionState = 'new';
          this.closed = false;
          made.push(this);
        }
        addEventListener() {}
        removeEventListener() {}
        async setRemoteDescription(d) { this.remote = d; }
        async createAnswer() { return { type: 'answer', sdp: `answer to ${this.remote.sdp}` }; }
        async setLocalDescription(d) {
          this.localDescription = d;
          if (/LIVE/.test(this.remote.sdp)) {
            setTimeout(() => { if (!this.closed && this.ondatachannel) this.ondatachannel({ channel: new FakeChannel() }); }, 10);
          }
        }
        close() { this.closed = true; }
      }
      const realPC = global.RTCPeerConnection;
      global.RTCPeerConnection = HandshakePC;
      const joinAs = name => joinNetwork({ exe: 'accept.exe', name, signaling: client() });
      const host = await joinAs('host');
      const ghost = await joinAs('ghost');
      const live = await joinAs('live');
      host.answerTimeoutMs = 400;
      const offerFrom = async (net, sdp) => {
        const hostSeen = (await net.peers()).find(p => p.userId === host.userId);
        const key = await sharedKeyWith(net.identity, hostSeen.publicKey);
        await net._post(await inboxKeyFor(net.scope, host.userId),
          Object.assign({ from: net.userId, publicKey: net.identity.publicKey },
            await sealed(key, { role: 'offer', sdp, at: Date.now() })));
      };
      const released = [];
      const serveOnce = timeoutMs => host.accept({
        timeoutMs, keepGoing: true,
        answerExtra: peer => ({ seat: peer.name }),
        release: extra => released.push(extra.seat),
      });
      try {
        await offerFrom(ghost, 'v=0 GHOST');
        await offerFrom(live, 'v=0 LIVE');

        await check('a live joiner is admitted while a dead offer is still being answered', async () => {
          const t0 = Date.now();
          const got = await serveOnce(5000);
          assert.strictEqual(got.peer.name, 'live');
          assert.deepStrictEqual(got.extra, { seat: 'live' });
          assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
          got.wire.close();
        });

        await check('answering a dead offer gives up on its own, and frees what it reserved', async () => {
          const end = Date.now() + 3000;
          while (!released.length && Date.now() < end) await new Promise(r => setTimeout(r, 20));
          assert.deepStrictEqual(released, ['ghost']);
          assert.ok(made.find(pc => /GHOST/.test(pc.remote.sdp)).closed, 'the dead attempt kept its connection');
        });

        await check('a dead offer is answered once, not again on every poll', async () => {
          const before = made.length;
          await assert.rejects(serveOnce(2500), /nobody tried to connect/);
          assert.strictEqual(made.length, before, 'the same offer was answered again');
        });

        await check('the same peer offering again is a new attempt', async () => {
          await offerFrom(ghost, 'v=0 LIVE again');
          const got = await serveOnce(5000);
          assert.strictEqual(got.peer.name, 'ghost');
          got.wire.close();
        });
      } finally {
        global.RTCPeerConnection = realPC;
        await Promise.all([host.leave(), ghost.leave(), live.leave()]);
      }
    }

    // ---- the other player leaving ---------------------------------------
    //
    // The match ending is invisible from inside the guest: the frames just
    // stop. These checks are the seam the UI banner hangs on.
    const grace = RtcWire.disconnectGraceMs;
    RtcWire.disconnectGraceMs = 20;
    const settle = () => new Promise(r => setTimeout(r, 60));
    try {
      await check('a channel that closes reports the peer gone, once', () => {
        const ch = new FakeChannel();
        const wire = new RtcWire(ch);
        const seen = [];
        wire.onClosed = why => seen.push(why);
        ch.hangUp();
        ch.hangUp();
        if (ch.onerror) ch.onerror();
        assert.strictEqual(seen.length, 1, `fired ${seen.length} times: ${seen}`);
        assert.strictEqual(wire.closed, true);
      });

      await check('quitting ourselves is not a disconnection', () => {
        const ch = new FakeChannel();
        const wire = new RtcWire(ch);
        let fired = 0;
        wire.onClosed = () => { fired++; };
        wire.close();
        if (ch.onclose) ch.onclose();
        assert.strictEqual(fired, 0);
      });

      await check('a failed connection reports the peer gone', () => {
        const ch = new FakeChannel();
        const pc = new FakePeerConnection();
        const wire = new RtcWire(ch, pc);
        let why = null;
        wire.onClosed = reason => { why = reason; };
        pc.set('failed');
        assert.strictEqual(why, 'failed');
      });

      await check('an ICE blip that recovers says nothing', async () => {
        const ch = new FakeChannel();
        const pc = new FakePeerConnection();
        const wire = new RtcWire(ch, pc);
        let fired = 0;
        wire.onClosed = () => { fired++; };
        pc.set('disconnected');
        pc.set('connected');
        await settle();
        assert.strictEqual(fired, 0);
      });

      await check('an ICE drop that does not recover reports the peer gone', async () => {
        const ch = new FakeChannel();
        const pc = new FakePeerConnection();
        const wire = new RtcWire(ch, pc);
        let why = null;
        wire.onClosed = reason => { why = reason; };
        pc.set('disconnected');
        await settle();
        assert.strictEqual(why, 'disconnected');
      });

      await check('a throwing listener does not take the wire down with it', () => {
        const ch = new FakeChannel();
        const wire = new RtcWire(ch);
        wire.onClosed = () => { throw new Error('listener is broken'); };
        ch.hangUp();
        assert.strictEqual(wire.closed, true);
      });
    } finally {
      RtcWire.disconnectGraceMs = grace;
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log(failures
    ? `test-vlan-rtc: ${failures} FAILED`
    : 'test-vlan-rtc: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
