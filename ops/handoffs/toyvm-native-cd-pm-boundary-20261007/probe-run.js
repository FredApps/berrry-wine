'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { validate } = require('../probes/common');
const { outputCollector } = require('../probes/output');
async function main() {
  const out = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !process.argv.includes('--slot-granted') || fs.existsSync(out)) throw Error('probe-run.js fresh-output --slot-granted');
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '../probes/ready.json'))), disk = validate(plan);
  const pngPath = require.resolve(path.join(plan.sourceRoot, 'node_modules/pngjs'));
  const png = require(pngPath); if (typeof png.PNG?.sync?.write !== 'function') throw Error('PNG writer dependency unavailable');
  const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'ready-source.json')));
  for (const [name, digest] of Object.entries(proof.helpers)) { if (require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex') !== digest) throw Error('diagnostic helper drift: ' + name); }
  fs.mkdirSync(out); const save = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n');
  save('pins.json', plan); save('disk-start.json', disk); save('dependency.json', { pngPath, realPath: fs.realpathSync(pngPath) });
  save('diagnostic-pins.json', proof);
  for (const name of Object.keys(proof.helpers)) fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
  const started = Date.now(), results = []; let child;
  const kill = signal => { if (child) try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  process.on('SIGTERM', () => kill('SIGTERM'));
  try {
    for (const id of ['arena', 'daggerfall']) {
      const entry = plan.entries.find(x => x.id === id);
      const args = [path.join(__dirname, 'probe-child.js'), plan.sourceRoot, id, out, proof.sourceHash];
      const remaining = 33000 - (Date.now() - started); if (remaining < 3000) throw Error('overall budget exhausted before next title');
      const receipt = { id, args, startedAt: new Date().toISOString(), limitMs: Math.min(id === 'arena' ? 10000 : 20000, remaining) };
      child = spawn(process.execPath, args, { cwd: plan.sourceRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); receipt.pid = child.pid;
      console.log(JSON.stringify(receipt)); save(id + '-start.json', receipt);
      const collector = outputCollector();
      child.stdout.on('data', b => collector.add(b)); child.stderr.on('data', b => collector.add(b));
      let forced = false, escalation;
      const timer = setTimeout(() => { forced = true; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 1000); }, receipt.limitMs - 1500);
      const status = await new Promise(resolve => { child.on('error', e => resolve({ error: String(e) })); child.on('close', (code, signal) => resolve({ code, signal })); });
      clearTimeout(timer); clearTimeout(escalation); kill('SIGKILL'); child = null;
      const output = collector.finish();
      fs.writeFileSync(path.join(out, id + '.log'), output.bytes);
      results.push({ ...receipt, ...status, finishedAt: new Date().toISOString(), forced, totalOutputBytes: output.total, retainedOutputBytes: output.retained, omittedOutputBytes: output.omitted, streamSha256: output.streamSha256 });
      save(id + '-result.json', results.at(-1));
    }
  } finally {
    kill('SIGKILL');
    save('cleanup.json', { at: new Date().toISOString(), elapsedMs: Date.now() - started, childStillTracked: !!child, results, interpretation: 'short CD/PM diagnostic; budget exhaustion is unknown; modified compiled shape is not a performance result; flat file lookup and original drive limitations retained; no gameplay qualification' });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
