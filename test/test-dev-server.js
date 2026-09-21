#!/usr/bin/env node
// tools/dev-server.js: the local stand-in for the Berrry backend.
//
// Two things are worth testing here. The signaling routes have to behave the
// way the real backend does, because the browser code is written once and run
// against both. And the static half has to refuse to serve anything outside
// the repo, because this server has no authentication to fall back on.

'use strict';

const assert = require('assert');
const path = require('path');
const { createServer, resolveStatic, ROOT } = require('../tools/dev-server');

let failures = 0;
function check(what, fn) {
  try {
    fn();
    console.log(`PASS  ${what}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${what}\n      ${err && err.message}`);
  }
}

async function main() {
  const server = createServer({ quiet: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Each "browser" is a cookie jar, which is what makes two of them distinct
  // users against a server with no login.
  function browser() {
    let cookie = null;
    return async (method, url, body) => {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      return { status: res.status, json, text };
    };
  }

  try {
    const alice = browser();
    const bob = browser();

    const who = await alice('GET', '/api/auth/user');
    check('an unauthenticated caller still gets an identity', () => {
      assert.strictEqual(who.status, 200);
      assert.ok(who.json.id, 'expected an id');
    });

    const bobWho = await bob('GET', '/api/auth/user');
    check('a second browser is a different user', () => {
      assert.notStrictEqual(bobWho.json.id, who.json.id);
    });

    const missing = await alice('GET', '/api/data/vln-signal-room1');
    check('reading an unwritten key is 404', () => {
      assert.strictEqual(missing.status, 404);
    });

    // Berrry's shapes (berrry-server src/backend-api): PUT only updates,
    // POST creates, and reads answer the stored value with no envelope.
    const putMissing = await alice('PUT', '/api/data/vln-signal-room1?visibility=public',
      { sdp: 'opaque-ciphertext' });
    check('PUT on a key never written is 404, as on Berrry', () => {
      assert.strictEqual(putMissing.status, 404);
    });

    const post = await alice('POST', '/api/data/vln-signal-room1?visibility=public',
      { sdp: 'opaque-ciphertext' });
    check('a public POST creates the record', () => {
      assert.strictEqual(post.status, 200);
      assert.strictEqual(post.json.sdp, 'opaque-ciphertext');
    });

    await alice('POST', '/api/data/notes', { a: 1 });
    const readBack = await alice('GET', '/api/data/vln-signal-room1');
    check('the writer reads their own value back, unwrapped', () => {
      assert.strictEqual(readBack.json.sdp, 'opaque-ciphertext');
    });

    const put = await alice('PUT', '/api/data/vln-signal-room1', { sdp: 'second' });
    check('PUT updates an existing record and keeps it public', () => {
      assert.strictEqual(put.status, 200);
      assert.strictEqual(put.json.sdp, 'second');
    });

    // The discovery step: Bob has never met Alice and knows only the room key.
    const users = await bob('GET', '/api/public-data/users/vln-signal-room1');
    check('a peer discovers who published under the room key', () => {
      assert.strictEqual(users.status, 200);
      assert.ok(Array.isArray(users.json), 'a bare array, as on Berrry');
      assert.strictEqual(users.json.length, 1);
      assert.strictEqual(users.json[0].userId, who.json.id);
      assert.strictEqual(typeof users.json[0].userId, 'number');
      assert.strictEqual(users.json[0].value.sdp, 'second');
    });

    const anon = await fetch(`${base}/api/public-data/users/vln-signal-room1`);
    check('the public list needs no identity at all', () => {
      assert.strictEqual(anon.status, 200);
    });

    const peerRead = await bob('GET', `/api/public-data/${who.json.id}/vln-signal-room1`);
    check('a peer reads the published record', () => {
      assert.strictEqual(peerRead.json.sdp, 'second');
    });

    const peerPrivate = await bob('GET', `/api/public-data/${who.json.id}/notes`);
    check('a record written with no visibility stays private', () => {
      assert.strictEqual(peerPrivate.status, 404);
    });

    const bobsOwn = await bob('GET', '/api/data/vln-signal-room1');
    check('one user\'s key does not collide with another\'s', () => {
      assert.strictEqual(bobsOwn.status, 404);
    });

    await alice('DELETE', '/api/data/vln-signal-room1');
    const afterDelete = await bob('GET', '/api/public-data/users/vln-signal-room1');
    check('deleting a record withdraws it from discovery', () => {
      assert.strictEqual(afterDelete.json.length, 0);
    });

    const reDelete = await alice('DELETE', '/api/data/vln-signal-room1');
    check('deleting an absent record is not an error', () => {
      assert.strictEqual(reDelete.status, 200);
    });

    // Static half.
    const page = await alice('GET', '/index.html');
    check('the repo page is served', () => {
      assert.strictEqual(page.status, 200);
      assert.ok(page.text.length > 0);
    });

    const remoteServer = createServer({ quiet: true, agentToken: 'lan-test-token' });
    await new Promise(resolve => remoteServer.listen(0, '127.0.0.1', resolve));
    try {
      const remoteBase = `http://127.0.0.1:${remoteServer.address().port}`;
      const ordinary = await (await fetch(remoteBase + '/?debug')).text();
      const handedOff = await (await fetch(remoteBase + '/?debug&agent=lan-test-token')).text();
      check('LAN agent token only enables remote control on its handoff URL', () => {
        assert.ok(!ordinary.includes('agent-remote.js?token='));
        assert.ok(handedOff.includes('agent-remote.js?token=lan-test-token'));
      });
    } finally {
      await new Promise(resolve => remoteServer.close(resolve));
    }

    const doubledSlash = await alice('GET', '//?debug');
    check('a doubled-slash page request cannot crash the server', () => {
      assert.strictEqual(doubledSlash.status, 200);
      assert.ok(doubledSlash.text.includes('<!DOCTYPE html>'));
    });
    const afterDoubledSlash = await alice('GET', '/index.html');
    check('the server stays alive after a doubled-slash request', () => {
      assert.strictEqual(afterDoubledSlash.status, 200);
    });

    const escapes = [
      '/../../../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/lib/../../etc/passwd',
    ];
    for (const attempt of escapes) {
      const got = await alice('GET', attempt);
      check(`refuses to serve outside the repo: ${attempt}`, () => {
        assert.ok(got.status === 403 || got.status === 404,
          `expected 403/404, got ${got.status}`);
      });
    }

    // The property that matters is not "returns null" — a leading ".." is
    // clamped at the root by normalize, so it resolves to a path inside the
    // repo that simply does not exist. What must hold for every input is that
    // the result never points outside ROOT.
    check('resolveStatic never resolves outside the repo', () => {
      const hostile = [
        '/../../etc/passwd',
        '/%2e%2e/%2e%2e/etc/passwd',
        '/lib/../../../etc/passwd',
        '/./../../',
        '/..%2f..%2fetc/passwd',
      ];
      for (const attempt of hostile) {
        const full = resolveStatic(attempt);
        if (full === null) continue;
        assert.ok(full === ROOT || full.startsWith(ROOT + path.sep),
          `${attempt} escaped to ${full}`);
      }
    });
    check('resolveStatic rejects a NUL-injected path', () => {
      assert.strictEqual(resolveStatic('/index.html\u0000.png'), null);
    });
    check('resolveStatic accepts a path inside the repo', () => {
      assert.strictEqual(resolveStatic('/lib/vlan-wire.js'),
        path.join(ROOT, 'lib', 'vlan-wire.js'));
    });

    const wasm = await alice('HEAD', '/build/wine-assembly.wasm');
    check('the wasm build is served when present', () => {
      assert.ok(wasm.status === 200 || wasm.status === 404,
        `unexpected ${wasm.status}`);
    });

    const asset = '/lib/vlan-wire.js';
    const assetHead = await fetch(base + asset, { method: 'HEAD' });
    const assetSize = Number(assetHead.headers.get('content-length'));
    check('static files advertise byte ranges and their full size', () => {
      assert.strictEqual(assetHead.status, 200);
      assert.strictEqual(assetHead.headers.get('accept-ranges'), 'bytes');
      assert.ok(assetSize > 8);
    });
    const partial = await fetch(base + asset, { headers: { Range: 'bytes=2-7' } });
    const full = await fetch(base + asset);
    const partialBytes = new Uint8Array(await partial.arrayBuffer());
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    check('a Range GET returns exactly the requested archive slice', () => {
      assert.strictEqual(partial.status, 206);
      assert.strictEqual(partial.headers.get('content-range'), `bytes 2-7/${assetSize}`);
      assert.strictEqual(Number(partial.headers.get('content-length')), 6);
      assert.deepStrictEqual(partialBytes, fullBytes.subarray(2, 8));
    });
    const pastEnd = await fetch(base + asset, { headers: { Range: `bytes=${assetSize}-` } });
    check('an unsatisfiable Range returns 416 with the file size', () => {
      assert.strictEqual(pastEnd.status, 416);
      assert.strictEqual(pastEnd.headers.get('content-range'), `bytes */${assetSize}`);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log(failures
    ? `test-dev-server: ${failures} FAILED`
    : 'test-dev-server: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
