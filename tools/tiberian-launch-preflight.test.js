'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), vm = require('node:vm');
const {checkedPreflightLaunch, matchingHttpPreflight} = require('./tiberian-launch-preflight');
const {consumerBrowser} = require('./tiberian-consumer-overlay');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiberian-preflight-test-'));
  const b = Buffer.alloc(256, 37); fs.writeFileSync(path.join(dir, 'pinned'), b);
  const required = ['build/wine-assembly.wasm', 'lib/guest-worker.js', 'lib/guest-thread-host.js', 'index.html'];
  const plan = {paths: Object.fromEntries(required.map(n => [n, path.join(dir, 'pinned')])), sourceHashes: Object.fromEntries(required.map(n => [n, 'test'])), aliases: {}, optionalAbsent: ['build-info.js']};
  const requests = []; let broken = false, launches = 0;
  const server = http.createServer((req, res) => { requests.push(req.url); if (broken || req.url === '/build-info.js') return res.writeHead(404).end(); res.setHeader('cross-origin-embedder-policy', 'require-corp'); if (req.headers.range) res.writeHead(206).end(b.subarray(0, 64)); else if (req.method === 'HEAD') res.writeHead(200).end(); else res.end(b); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const receipts = [], preflight = () => matchingHttpPreflight({plan, port: server.address().port}), launch = async () => { launches++; return 'Chrome sentinel'; };
    broken = true; await assert.rejects(checkedPreflightLaunch({preflight, launch, receipt: r => receipts.push(r)}), /mandatory HEAD failed/); assert.equal(launches, 0, 'FAILED HTTP preflight MUST prevent Chrome');
    await assert.rejects(checkedPreflightLaunch({preflight: async () => ({passed: false}), launch}), /did not pass/); assert.equal(launches, 0);
    broken = false; assert.equal(await checkedPreflightLaunch({preflight, launch, receipt: r => receipts.push(r)}), 'Chrome sentinel'); assert.equal(launches, 1); assert(!requests.includes('/build-info.js'));
    let checked = 0; await assert.rejects(checkedPreflightLaunch({preflight: async () => ({passed: true}), check: () => { if (++checked > 1) throw Error('lease expired'); }, launch}), /lease expired/); assert.equal(launches, 1);
    const prior = '/home/user/wine-assembly/scratch/runs/20261008T0126Z-tiberian-focused-command/browser.js';
    const generated = consumerBrowser(fs.readFileSync(prior, 'utf8')); new vm.Script(generated); assert(generated.includes("save('checked-preflight.json',r)")); assert(generated.includes('pause(6000)')); assert.throws(() => consumerBrowser('wrong'), /unique browser anchor/);
    // Execute the generated browser launch expression, not only the helper.
    const start = generated.indexOf('browser=await checkedPreflightLaunch('), end = generated.indexOf('\n lifecycle.check();', start);
    const expr = generated.slice(start, end), trace = [], context = {checkedPreflightLaunch, matchingHttpPreflight: async () => { trace.push('preflight'); throw Error('forced mandatory 404'); }, lifecycle: {check() {}, acquire: async f => { trace.push('acquire'); return f(); }}, puppeteer: {launch() { trace.push('Chrome'); }}, plan: {}, server: {address: () => ({port: 1})}, profile: dir, save: () => {}};
    await assert.rejects(vm.runInNewContext('(async()=>{let browser;'+expr+'})()', context), /forced mandatory 404/); assert.deepEqual(trace, ['preflight']);
    context.matchingHttpPreflight = async () => { trace.push('pass'); return {passed: true}; };
    await vm.runInNewContext('(async()=>{let browser;'+expr+'})()', context); assert.deepEqual(trace, ['preflight', 'pass', 'acquire', 'Chrome']);
    console.log('PASS real HTTP failure blocks Chrome, mandatory pins/optional absent/range, expired lease and generated sequential browser launch');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, {recursive: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
