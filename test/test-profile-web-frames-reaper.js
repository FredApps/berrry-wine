#!/usr/bin/env node
'use strict';

// tools/profile-web-frames.js reaps browsers a killed harness left behind.
// It used to kill EVERY Chrome whose command line carried its profile
// prefix, which on a shared box killed other agents' live runs mid-sample.
// Now a browser dies only when the harness that owns its profile is gone.
// Stand-ins for browsers: node processes whose command line carries a
// --user-data-dir under the tool's prefix.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { killStaleBrowsers, OWNER_FILE, PROFILE_PREFIX } = require('../tools/profile-web-frames');

const alive = pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const liveDir = mk(), orphanDir = mk(), legacyDir = mk();
  // A live owner (this test process) and a dead one (a process that has exited).
  fs.writeFileSync(path.join(liveDir, OWNER_FILE), String(process.pid));
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  fs.writeFileSync(path.join(orphanDir, OWNER_FILE), String(dead));
  // legacyDir: no owner file and freshly made -- an older copy of the tool
  // that may still be running.
  const fake = dir => spawn(process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)', '--', `--user-data-dir=${dir}`], { stdio: 'ignore' });
  const live = fake(liveDir), orphan = fake(orphanDir), legacy = fake(legacyDir);
  await sleep(300);
  try {
    killStaleBrowsers();
    await sleep(300);
    assert.ok(alive(live.pid), "a browser whose harness is alive is left running");
    assert.ok(!alive(orphan.pid), 'a browser whose harness is gone is reaped');
    assert.ok(alive(legacy.pid), 'a fresh profile with no owner file is left running');
  } finally {
    for (const p of [live, orphan, legacy]) { try { p.kill('SIGKILL'); } catch (_) {} }
    for (const d of [liveDir, orphanDir, legacyDir]) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log('PASS test-profile-web-frames-reaper');
})().catch(err => { console.error(err); process.exit(1); });
