'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process'), crypto = require('node:crypto');
const { outputCollector } = require('../probes/output');
async function main() {
  const out = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !process.argv.includes('--slot-granted') || fs.existsSync(out)) throw Error('run.js fresh-output --slot-granted');
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'ready.json'))), sha = b => crypto.createHash('sha256').update(b).digest('hex');
  for (const [p, h] of Object.entries(plan.sources)) if (sha(fs.readFileSync(path.join(plan.sourceRoot, p))) !== h) throw Error('source drift ' + p);
  for (const [p, h] of Object.entries(plan.helpers)) if (sha(fs.readFileSync(path.join(__dirname, p))) !== h) throw Error('helper drift ' + p);
  const disk = fs.statfsSync(plan.sourceRoot); if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw Error('disk floor2GiB');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'pins.json'), JSON.stringify(plan, null, 2));
  const start = Date.now(); const child = spawn(process.execPath, [path.join(__dirname, 'contract.js'), plan.sourceRoot, path.join(out, 'cases'), 'before', '--slot-granted'], { detached: true, stdio: ['ignore','pipe','pipe'] });
  const kill = signal => { try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  console.log(JSON.stringify({ pid: child.pid, startedAt: new Date(start).toISOString(), deadline: new Date(start + 40000).toISOString() }));
  const logs = outputCollector(); child.stdout.on('data', b => logs.add(b)); child.stderr.on('data', b => logs.add(b));
  let forced = false, escalation;
  const timer = setTimeout(() => { forced = true; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 1000); }, 35000);
  let status;
  try { status = await new Promise(resolve => { child.on('error', e => resolve({ error: String(e) })); child.on('close', (code, signal) => resolve({ code, signal })); }); }
  finally { clearTimeout(timer); clearTimeout(escalation); kill('SIGKILL'); }
  const log = logs.finish(); fs.writeFileSync(path.join(out, 'stdout.log'), log.bytes);
  fs.writeFileSync(path.join(out, 'cleanup.json'), JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - start, pid: child.pid, ...status, forced, outputBytes: log.total, omittedBytes: log.omitted, streamSha256: log.streamSha256 }, null, 2));
  if (status.code !== 0 || forced) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
