#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { startControlSession } = require('./control-session');
const sessions = [];
function start(args, options) {
  const session = startControlSession(args, options);
  sessions.push(session);
  return session;
}
const deadline = setTimeout(() => {
  console.error('FAIL control session did not settle within 10 seconds');
  for (const { child } of sessions) if (child.exitCode === null) child.kill();
  process.exitCode = 1;
}, 10000);

(async () => {
  const echo = start(['-e', `
    const lines = require('readline').createInterface({ input: process.stdin });
    lines.on('line', line => {
      const request = JSON.parse(line);
      const reply = '[ctl] ' + JSON.stringify({ id: request.id, ok: true,
        value: request.action === 'step' ? request.n : request.cmd || request.action }) + '\\r\\n';
      process.stdout.write('ordinary log\\n[ctl] invalid JSON\\n[ctl] null\\n');
      process.stdout.write(reply.slice(0, 9));
      setImmediate(() => {
        process.stdout.write(reply.slice(9));
        if (request.action === 'quit') { lines.close(); process.stdin.destroy(); }
      });
    });
  `]);
  assert.strictEqual(await echo.send({ id: 'caller-id', cmd: 'ping' }), 'ping');
  assert.strictEqual(await echo.step(7), 7);
  const cyclic = {}; cyclic.value = cyclic;
  await assert.rejects(echo.send(cyclic), /circular/i);
  assert.strictEqual(await echo.send('still usable'), 'still usable');
  assert.strictEqual(await echo.quit(), 0);
  assert.strictEqual(await echo.quit(), 0);
  await assert.rejects(echo.send('too late'), /exited|closed/);
  assert(echo.output().includes('ordinary log'));

  const crash = start(['-e', `process.stdin.once('data', () => process.exit(7));`]);
  const results = await Promise.allSettled([crash.send('one'), crash.send('two')]);
  assert(results.every(result => result.status === 'rejected'));
  assert.strictEqual(await crash.exited, 7);
  await assert.rejects(crash.step(1), /exited|closed/);

  const finalReply = start(['-e', `
    process.stdin.once('data', line => {
      const { id } = JSON.parse(line);
      process.stdout.write('[ctl] ' + JSON.stringify({ id, ok: true,
        value: 'x'.repeat(512 * 1024) }) + '\\n', () => process.exit(0));
    });
  `]);
  assert.strictEqual((await finalReply.send('last reply')).length, 512 * 1024);
  assert.strictEqual(await finalReply.exited, 0);

  const remoteError = start(['-e', `
    process.stdin.once('data', line => {
      const { id } = JSON.parse(line);
      process.stdout.write('[ctl] ' + JSON.stringify({ id, ok: false,
        error: 'fixture rejection' }) + '\\n', () => process.exit(0));
    });
  `]);
  await assert.rejects(remoteError.send('reject'), /fixture rejection/);
  assert.strictEqual(await remoteError.exited, 0);

  const missing = start([], { command: '/__wa_control_session_missing_executable__' });
  await assert.rejects(missing.send('ping'), /ENOENT/);
  await missing.exited;
  await assert.rejects(missing.send('later'), /ENOENT/);
  await missing.quit({ ignoreReplyError: true });

  const signaled = start(['-e', 'process.stdin.resume();']);
  const pending = signaled.send('waiting');
  const rejected = assert.rejects(pending, /exited|closed/);
  signaled.child.kill('SIGTERM');
  await rejected;
  assert.strictEqual(await signaled.exited, null);
  await assert.rejects(signaled.send('after signal'), /exited|closed/);
  await signaled.quit();
  console.log('PASS control-session framing, IDs, serialization, exit, signal and spawn failure');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(deadline);
  for (const { child } of sessions) if (child.exitCode === null) child.kill();
  await Promise.all(sessions.map(session => session.exited));
});
