'use strict';

// "Is this game serving?" asked of a running test/run.js child the way the
// browser shell asks it (gameServing in lib/browser-shell.js): through the
// guest's own socket or DDE service table, for the app's hostProbe of
// protocol 'serving' (lib/vlan-star.js). The child needs --control-stdin and
// a piped stdin; the answer comes back as its "[ctl] {...}" line.

let nextId = 0;

function servingCode(spec) {
  if (!spec || spec.protocol !== 'serving') throw new Error('not a serving hostProbe');
  return spec.dde ? '!!exports.dde_serving()' : `!!exports.net_listening(${spec.listen | 0})`;
}

function evalInChild(child, code, timeoutMs = 60000) {
  const id = `serving-${process.pid}-${++nextId}`;
  return new Promise((resolve, reject) => {
    let carry = '';
    const done = (fn, v) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      fn(v);
    };
    const onData = chunk => {
      const lines = (carry + chunk.toString()).split('\n');
      carry = lines.pop();
      for (const line of lines) {
        const at = line.indexOf('[ctl] {');
        if (at < 0) continue;
        let reply;
        try { reply = JSON.parse(line.slice(at + 6)); } catch (_) { continue; }
        if (reply.id !== id) continue;
        if (reply.ok) done(resolve, reply.value);
        else done(reject, new Error(reply.error));
        return;
      }
    };
    const timer = setTimeout(() => done(reject, new Error(`no answer to ${code}`)), timeoutMs);
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify({ id, action: 'eval', code }) + '\n');
  });
}

// Resolves true/false; rejects if the child never answers.
function askServing(child, spec, timeoutMs) {
  return evalInChild(child, servingCode(spec), timeoutMs).then(v => v === true);
}

module.exports = { askServing, servingCode, evalInChild };
