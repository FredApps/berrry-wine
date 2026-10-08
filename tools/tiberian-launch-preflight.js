'use strict';
const fs = require('node:fs'), http = require('node:http'), crypto = require('node:crypto');
async function checkedPreflightLaunch({preflight, launch, check = () => {}, receipt = () => {}}) {
  check();
  try {
    const verified = await preflight(); check();
    if (verified?.passed !== true) throw Error('preflight did not pass');
    receipt({phase: 'preflight', passed: true, at: new Date().toISOString(), verified});
    check(); return await launch();
  } catch (e) {
    receipt({phase: 'preflight-or-launch', passed: false, at: new Date().toISOString(), error: String(e)});
    throw e;
  }
}
async function matchingHttpPreflight({plan, port, check = () => {}}) {
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  let heads = 0, gets = 0;
  async function request(rel, method = 'HEAD', headers = {}) {
    check();
    const response = await new Promise((resolve, reject) => {
      const req = http.request({host: '127.0.0.1', port, path: '/' + encodeURI(rel), method, headers, timeout: 5000}, res => {
        const chunks = []; let bytes = 0;
        res.on('data', b => { bytes += b.length; if (bytes > 64 * 1024 * 1024) { req.destroy(Error('preflight body cap')); return; } chunks.push(b); });
        res.on('error', reject); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
      });
      req.on('timeout', () => req.destroy(Error('preflight timeout'))); req.on('error', reject); req.end();
    });
    check(); return response;
  }
  // Optional shell paths are deliberately absent; they are not mandatory pins.
  for (const rel of [...Object.keys(plan.sourceHashes), ...Object.keys(plan.aliases || {})]) {
    const r = await request(rel);
    if (r.status !== 200 || r.headers['cross-origin-embedder-policy'] !== 'require-corp') throw Error('mandatory HEAD failed ' + rel + ' ' + r.status);
    heads++;
  }
  const targets = ['build/wine-assembly.wasm', 'lib/guest-worker.js', 'lib/guest-thread-host.js', 'index.html', ...Object.keys(plan.aliases || {}).filter(n => n.endsWith('/SUN.EXE'))];
  for (const rel of targets) {
    const r = await request(rel, 'GET'), source = plan.aliases?.[rel] || rel;
    if (r.status !== 200 || sha(r.body) !== sha(fs.readFileSync(plan.paths[source]))) throw Error('mandatory GET failed ' + rel);
    gets++;
  }
  const range = await request('build/wine-assembly.wasm', 'GET', {Range: 'bytes=0-63'});
  if (range.status !== 206 || sha(range.body) !== sha(fs.readFileSync(plan.paths['build/wine-assembly.wasm']).subarray(0, 64))) throw Error('range preflight failed');
  return {passed: true, heads, gets, range: true};
}
module.exports = {checkedPreflightLaunch, matchingHttpPreflight};
