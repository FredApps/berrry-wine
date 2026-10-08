'use strict';
// Private diagnostic entry. Only the external supervisor grants/bounds a run.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const [root, id, out, expectedEmitter] = process.argv.slice(2);
  if (!['arena', 'daggerfall'].includes(id) || !out || !expectedEmitter) throw Error('exact entry arguments required');
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '../probes/ready.json')));
  if (root !== plan.sourceRoot) throw Error('source root mismatch');
  const entry = plan.entries.find(row => row.id === id);
  if (!entry || sha(fs.readFileSync(entry.absolute)) !== entry.sha256) throw Error('entry identity mismatch');
  const observed = require('./observe').observer();
  let injected, restoreStep, result, error;
  try {
    if (id === 'daggerfall') injected = require('./install').install(root, expectedEmitter);
    const { DosSession } = require(path.join(root, 'tools/toyvm/dos-loop'));
    if (injected) restoreStep = observed.install(DosSession.prototype);
    const api = require(path.join(root, 'tools/toyvm/run-dos'));
    const r = await api.runDos({ exe: entry.absolute, guestArgs: entry.args,
      env: Object.entries(entry.env).map(([k, v]) => k + '=' + v),
      budget: 5e6, seconds: id === 'arena' ? 2 : 3,
      traceInt: true, traceEntry: 300, traceEntryRegs: true, report: true });
    result = { id, entry, sourceRoot: root, exited: r.machine.exited, exitCode: r.machine.exitCode,
      ranOutOfTime: r.ranOutOfTime, dispatched: r.dispatched, handbacks: r.handbacks,
      unimplemented: [...r.unimplemented], badSelector: r.badSelector,
      cs: r.vm.get('cs'), ip: r.vm.get('gip'), cr0: r.vm.exports.get_cr0() >>> 0,
      moduleSha256: sha(r.vm.bytes), moduleBytes: r.vm.bytes.length,
      sourceClosure: Object.keys(require.cache).filter(p => p.startsWith(root + path.sep)).sort().map(p => ({ path: path.relative(root, p), sha256: sha(fs.readFileSync(p)) })) };
    if (r.surface.text) api.writeConsolePng(path.join(out, id + '.png'), r.machine.con);
    else api.writePng(path.join(out, id + '.png'), r.vm.mem, r.machine.palette, r.surface.geom);
  } catch (e) { error = String(e.stack || e); }
  finally {
    const cleanup = { stepRestored: restoreStep ? restoreStep() : null, emitterRestored: injected ? injected.restore() : null };
    const observation = observed.result();
    fs.writeFileSync(path.join(out, id + '-observation.json'), JSON.stringify({ result, error, observation, cleanup,
      completeCapture: !error && observation.errors.length === 0 && (id === 'arena' || (!observation.capped && observation.rows.length > 0)),
      scope: 'diagnostic startup only; capped/missing/error rows cannot prove absence; no gameplay or performance result',
      emitter: injected ? { originalSha256: injected.originalSha256, privateSha256: injected.privateSha256 } : null }, null, 2));
  }
  if (error) throw Error(error);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
