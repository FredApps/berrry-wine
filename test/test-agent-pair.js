#!/usr/bin/env node
// lib/agent-pair.js — the pairing format, no browser and no network
// (docs/design-agent-connect.md section 3).
//
// Covers what the two ends must agree on byte for byte: the wa1 token (the
// page's offer packed into the pasted link), the minimal SDP each end
// rebuilds from it, the sealed + signed answer record, and the data-channel
// chunking a screenshot reply rides on.

'use strict';

const assert = require('assert');
const nacl = require('../lib/vendor/tweetnacl');
const pair = require('../lib/agent-pair');

let failures = 0;
function check(what, fn) {
  try {
    fn();
    console.log(`PASS  ${what}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${what}\n      ${err && err.stack || err}`);
  }
}

// The shape Chrome actually produces for a data-channel-only offer with no
// media permission: the host address hidden behind an mDNS name, a STUN
// server-reflexive candidate, a TCP candidate that must be dropped, and one
// duplicate.
const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 58793 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.7',
  'a=candidate:3067391126 1 udp 2113937151 1f8a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b.local 58793 typ host generation 0 network-cost 999',
  'a=candidate:3067391126 1 udp 2113937151 1f8a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b.local 58793 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 udp 1677729535 203.0.113.7 58793 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=candidate:1 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active',
  'a=candidate:9 1 udp 2122260223 fe80::1 50000 typ host',
  'a=ice-ufrag:Xk9Q',
  'a=ice-pwd:Qm9vZGxlcy1hcmUtZ29vZC4u',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

// werift's answers carry plain IPv4 host candidates.
const ANSWER = CHROME_OFFER
  .replace('a=ice-ufrag:Xk9Q', 'a=ice-ufrag:ab12')
  .replace('a=ice-pwd:Qm9vZGxlcy1hcmUtZ29vZC4u', 'a=ice-pwd:0123456789abcdef012345')
  .replace(FP, FP.replace(/^AB/, '11'))
  .replace(/a=candidate:3067391126[^\r]*\r\n/g, '')
  .replace('a=candidate:842163049', 'a=candidate:5 1 udp 2130706431 192.168.1.20 61000 typ host\r\na=candidate:842163049');

function bot(name) {
  const kp = nacl.sign.keyPair();
  return { username: name, runsAs: 'Test Agent', secretKey: kp.secretKey, pub: kp.publicKey };
}

check('parseSdp keeps UDP candidates, drops TCP and duplicates, reads mDNS/IPv4/IPv6', () => {
  const parts = pair.parseSdp(CHROME_OFFER);
  assert.strictEqual(parts.ufrag, 'Xk9Q');
  assert.strictEqual(parts.pwd, 'Qm9vZGxlcy1hcmUtZ29vZC4u');
  assert.strictEqual(parts.fingerprint.length, 32);
  assert.deepStrictEqual(parts.candidates.map(c => c.kind), ['mdns', 'srflx4', 'host6']);
});

check('token round-trips the offer, and stays short enough for one chat line', () => {
  const made = pair.makeToken(CHROME_OFFER);
  assert.ok(made.token.startsWith('wa1.'));
  assert.ok(made.token.length < 260, `token is ${made.token.length} chars`);
  const read = pair.readToken(made.token);
  assert.deepStrictEqual(Array.from(read.id), Array.from(made.id));
  assert.deepStrictEqual(Array.from(read.key), Array.from(made.key));
  assert.strictEqual(read.expires, made.expires);
  const orig = pair.parseSdp(CHROME_OFFER);
  assert.strictEqual(read.offer.ufrag, orig.ufrag);
  assert.strictEqual(read.offer.pwd, orig.pwd);
  assert.deepStrictEqual(Array.from(read.offer.fingerprint), Array.from(orig.fingerprint));
  assert.deepStrictEqual(read.offer.candidates.map(c => [c.kind, c.port]),
    orig.candidates.map(c => [c.kind, c.port]));
  assert.strictEqual(read.offer.candidates[0].addr, '1f8a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b.local');
  assert.strictEqual(read.offer.candidates[1].addr, '203.0.113.7');
  assert.strictEqual(read.recordKey, 'agentpair:' + pair.hex(made.id));
});

check('the token is found inside the pasted sentence and the #fragment link', () => {
  const { token } = pair.makeToken(CHROME_OFFER);
  const pasted = `Play my game: https://wine-assembly.berrry.app/skills/wine-assembly-connect/SKILL.md#${token}`;
  assert.strictEqual(pair.extractToken(pasted), token);
  assert.strictEqual(pair.readToken(pasted).token, token);
});

check('minimalSdp rebuilds a parseable SDP with the same session parts', () => {
  const read = pair.readToken(pair.makeToken(CHROME_OFFER).token);
  const sdp = pair.minimalSdp(read.offer, 'offer');
  assert.ok(/a=setup:actpass/.test(sdp));
  assert.ok(/m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel/.test(sdp));
  const again = pair.parseSdp(sdp);
  assert.strictEqual(again.ufrag, read.offer.ufrag);
  assert.deepStrictEqual(again.candidates, read.offer.candidates);
  assert.ok(/a=setup:active/.test(pair.minimalSdp(read.offer, 'answer')));
});

check('a sealed answer opens with the pairing key and names the signing bot', () => {
  const made = pair.makeToken(CHROME_OFFER);
  const pairing = pair.readToken(made.token);
  const b = bot('wanderbot');
  const record = pair.sealAnswer(pairing, ANSWER, b);
  // What sits in the world-readable store says nothing in the clear.
  assert.ok(!JSON.stringify(record).includes('wanderbot'));
  assert.ok(!JSON.stringify(record).includes('192.168'));
  const opened = pair.openAnswer(made, record);
  assert.ok(opened, 'record did not open');
  assert.strictEqual(opened.bot.username, 'wanderbot');
  assert.strictEqual(opened.bot.runsAs, 'Test Agent');
  assert.strictEqual(opened.bot.pub, pair.hex(b.pub));
  assert.ok(/^[0-9a-f]{4}·[0-9a-f]{4}·[0-9a-f]{4}$/.test(opened.bot.keyLabel));
  const answerParts = pair.parseSdp(opened.sdp);
  assert.strictEqual(answerParts.ufrag, 'ab12');
  assert.deepStrictEqual(answerParts.candidates.map(c => c.kind), ['host4', 'srflx4', 'host6']);
});

check('a record for another pairing, a forged signature or a tampered body does not open', () => {
  const a = pair.makeToken(CHROME_OFFER);
  const b = pair.makeToken(CHROME_OFFER);
  const record = pair.sealAnswer(pair.readToken(a.token), ANSWER, bot('wanderbot'));
  assert.strictEqual(pair.openAnswer(b, record), null, 'opened under another key');
  const tampered = Object.assign({}, record, { ct: record.ct.slice(0, -4) + 'AAAA' });
  assert.strictEqual(pair.openAnswer(a, tampered), null, 'tampered record opened');
  // A key holder who is not the bot it names: the signature is over the
  // pairing id, so re-sealing the payload under another pubkey fails verify.
  const nacl2 = require('../lib/vendor/tweetnacl');
  const plain = JSON.parse(new TextDecoder().decode(
    nacl2.secretbox.open(pair.unb64url(record.ct), pair.unb64url(record.iv), a.key)));
  plain.bot.pub = pair.hex(nacl2.sign.keyPair().publicKey);
  const iv = nacl2.randomBytes(24);
  const forged = { v: 1, iv: pair.b64url(iv), ct: pair.b64url(nacl2.secretbox(new TextEncoder().encode(JSON.stringify(plain)), iv, a.key)) };
  assert.strictEqual(pair.openAnswer(a, forged), null, 'forged signer accepted');
  assert.strictEqual(pair.openAnswer(a, null), null);
  assert.strictEqual(pair.openAnswer(a, { v: 1 }), null);
});

check('a bad version or a truncated token is refused with a message', () => {
  const { token } = pair.makeToken(CHROME_OFFER);
  const bytes = pair.unb64url(token.slice(4));
  bytes[0] = 9;
  assert.throws(() => pair.readToken('wa1.' + pair.b64url(bytes)), /version 9/);
  assert.throws(() => pair.readToken(token.slice(0, 60)), /truncated/);
  assert.throws(() => pair.readToken('hello'), /no wa1/);
});

check('frames + assembler carry a large reply in chunks and small ones whole', () => {
  const big = { id: 7, ok: true, value: 'data:image/png;base64,' + 'A'.repeat(100000) };
  const small = { id: 8, ok: true, value: { pong: true } };
  const out = [];
  const receive = pair.assembler(m => out.push(m));
  const bigFrames = pair.frames(big);
  assert.ok(bigFrames.length > 1);
  assert.ok(bigFrames.every(f => f.length <= pair.CHUNK + 200));
  // Interleave a small message between chunks: reassembly is by id.
  receive(bigFrames[0]);
  for (const f of pair.frames(small)) receive(f);
  for (const f of bigFrames.slice(1)) receive(f);
  assert.deepStrictEqual(out, [small, big]);
});

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nall passed');
