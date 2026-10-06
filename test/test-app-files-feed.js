#!/usr/bin/env node
'use strict';
// tools/app-files-feed.js: the private test/binaries feed for boat forks.
// The server must hand out exactly the files under test/binaries and nothing
// else in the checkout; fetch must reproduce an app's registry files byte for
// byte under --dest. Skips (passes) when this checkout has no game binaries.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'app-files-feed.js');
const { APPS } = require('../lib/apps');
const APP = 'sol';
const exe = path.join(ROOT, APPS[APP].exe);
if (!fs.existsSync(exe)) {
  console.log(`SKIP test-app-files-feed: ${APPS[APP].exe} is not in this checkout`);
  process.exit(0);
}

const status = (port, rel) => new Promise(resolve => {
  http.get(`http://127.0.0.1:${port}/${rel}`, res => { res.resume(); resolve(res.statusCode); })
    .on('error', () => resolve(0));
});

(async () => {
  const server = spawn(process.execPath, [TOOL, 'serve', '--port=0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', d => {
      out += d;
      const m = /127\.0\.0\.1:(\d+)/.exec(out);
      if (m) resolve(+m[1]);
    });
    server.on('exit', () => reject(new Error('feed server exited: ' + out)));
  });
  try {
    assert.strictEqual(await status(port, 'package.json'), 403, 'files outside test/binaries are refused');
    assert.strictEqual(await status(port, 'test/binaries/../../package.json'), 403, 'no climbing out with ..');
    assert.strictEqual(await status(port, 'lib/apps.js'), 403, 'source is not served');
    assert.strictEqual(await status(port, 'test/binaries/no-such-file.bin'), 404);

    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
    try {
      const r = spawnSync(process.execPath, [TOOL, 'fetch', `--base=http://127.0.0.1:${port}`,
        `--apps=${APP}`, `--dest=${dest}`], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert(/missing on the feed 0/.test(r.stdout), r.stdout);
      const rel = path.posix.normalize(APPS[APP].exe).replace(/^binaries\//, 'test/binaries/');
      assert(fs.readFileSync(path.join(dest, rel)).equals(fs.readFileSync(exe)), 'the exe arrives byte for byte');
      const again = spawnSync(process.execPath, [TOOL, 'fetch', `--base=http://127.0.0.1:${port}`,
        `--apps=${APP}`, `--dest=${dest}`], { encoding: 'utf8' });
      assert(/fetched 0 /.test(again.stdout), 'a second fetch finds everything present: ' + again.stdout);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  } finally {
    server.kill();
  }
  console.log('PASS app-files-feed: serves only test/binaries; fetch reproduces an app\'s files and is idempotent');
})().catch(e => { console.error(e); process.exit(1); });
