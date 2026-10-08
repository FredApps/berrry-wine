'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {createObserver, install, overlay, linkOverlay, activateExisting} = require('../tools/antara-win16-callback');
let clock = 10, reads = 0; const switches = [], buffer = new ArrayBuffer(65536);
const values = {get_current_thread_id: 2, get_eip: 0x2100, get_esp: 0x3100, get_ebp: 0x120, get_eax: 1, get_edx: 0, get_sreg_cs: 0x47, get_sreg_ss: 0x87, get_sreg_ds: 0x37, win16_last_module: 2, win16_last_ordinal: 76};
const ex = {set_win16_trace: v => switches.push(v), guest_to_wasm: p => p, win16_seg_base: i => i === 8 ? 0x2000 : 0x3000, win16_seg_limit: () => 4096};
for (const [k, v] of Object.entries(values)) ex[k] = () => { reads++; return v; };
const options = {getExports: () => ex, getMemory: () => buffer, slot: 1, now: () => clock, baselineTrace: 0};
assert.throws(() => createObserver({...options, baselineTrace: 1}), /baseline/);
assert.throws(() => createObserver({...options, durationMs: 9000}), /bounds/);
const o = createObserver(options);
function frame(marker, words) { o.word(marker); for (const v of words) o.word(v); }
const call = (key, args = []) => frame(0xca16a9f0, [key, 0x2120, ...Array.from({length: 12}, (_, i) => args[i] || 0), 0]);
frame(0xca16a9eb, [98306, 0x201, 1, 0x00910198, 98306, 0]);
const paintReads = reads;
for(let i=0;i<500;i++){call(0x2006b,[0,0,0,15,2]);frame(0xca16a9ef,[0,0,0x2100,0x3100,14,0x37]);}
assert.equal(reads,paintReads);
assert.equal(reads, 0); assert.equal(o.status().rows.length, 0);
o.input(0x10201);assert.deepEqual(switches,[]);o.activate('forwarded');assert.deepEqual(switches,[1]);
for (let i = 0; i < 1000; i++) { frame(0xca16a9eb, [98306, 15, 0, 0, 98306, 0]); call(0x20042); frame(0xca16a9ef, [0, 0, 0x2100, 0x3100, 8, 0x37]); }
assert.equal(reads, 0); assert.deepEqual(o.status().bytes, {down: 0, up: 0});
frame(0xca16a9eb, [98306, 0x201, 1, 0x00910198, 98306, 0]);
call(0x2004c, [408, 145, 0x100, 0x37]);
assert.equal(o.status().rows.at(-1).owner.ptInRect.x, 408);
assert.equal(o.status().rows.at(-1).owner.ptInRect.y, 145);
// Marker-valued payloads are data, not a framing reset.
frame(0xca16a9ef, [0xca16a9eb, 0, 0x2100, 0x3100, 8, 0x37]);
assert.equal(o.status().rows.at(-1).kind, 'handler-exit');
assert.equal(o.status().rows.at(-1).words[0], 0xca16a9eb);
const downBytes = o.status().bytes.down; assert(downBytes > 0);
o.input(0x202); frame(0xca16a9eb, [98306, 0x202, 0, 0x00910198, 98306, 0]); call(0x2006b,[0,0,0,0x202,2]);
assert(o.status().bytes.up > 0); assert.equal(o.status().bytes.down, downBytes);
const before = reads; clock = 8010; call(0x2004c);
assert.equal(reads, before); assert.equal(o.status().reason, 'deadline'); assert.deepEqual(switches, [1, 0]);
clock = 0; const capped = createObserver({...options, maxRows: 4, maxBytes: 1024});
capped.activate('cap');capped.input(0x201); for(let i=0;i<100;i++) capped.importValue('check_input_hwnd', 98306);
capped.input(0x202); capped.importValue('check_input_hwnd', 98306);
assert.equal(capped.status().rows.length,4); assert(capped.status().omitted.down > 0);
assert.equal(capped.status().rows.at(-1).phase,'up'); capped.stop('test');

clock = 0; const h = {check_input() { assert.equal(this, h); return 0x201; }, log_i32() { return 17; }, check_input_hwnd() { return 98306; }, check_input_lparam() { return 0x00910198; }};
const originals = {...h}, wrapped = install(h, options);
wrapped.activate('imports');
assert.equal(h.check_input(), 0x201); assert.equal(h.log_i32(123), 17);
assert.equal(h.check_input_hwnd(), 98306); assert.equal(h.check_input_lparam(), 0x00910198);
wrapped.stop(); for (const n of Object.keys(h)) assert.equal(h[n], originals[n]);
const failure = Error('original failure'); h.check_input = () => { throw failure; };
const w2 = install(h, options); assert.throws(() => h.check_input(), e => e === failure); w2.stop();
const incomplete={...originals};delete incomplete.check_input_lparam;const saved={...incomplete};
assert.throws(()=>install(incomplete,options),/missing import check_input_lparam/);
assert.deepEqual(incomplete,saved);
const newerHost={...originals},owned=install(newerHost,options),newer=()=>999;
newerHost.log_i32=newer;owned.stop();assert.equal(newerHost.log_i32,newer);
const broken={...ex,set_win16_trace(v){if(v===0)throw Error('restore denied');}};
const brokenObserver=createObserver({...options,getExports:()=>broken});brokenObserver.activate('broken');brokenObserver.stop('test');
assert.equal(brokenObserver.status().active,false);assert.match(brokenObserver.status().flagRestoreError,/restore denied/);assert.equal(brokenObserver.status().errors,1);
// Expiry inside a getter prevents the buffer/translator from being touched.
for(const boundary of ['getter','buffer','translator']){
 clock=0;let bufferReads=0,translations=0,afterExpiryGetters=0;
 const guardedEx={...ex,guest_to_wasm(p){translations++;if(boundary==='translator')clock=8000;return p;}};
 for(const [n,v]of Object.entries(values))guardedEx[n]=()=>{if(clock>=8000)afterExpiryGetters++;if(boundary==='getter'&&n==='get_current_thread_id')clock=8000;return v;};
 const g=createObserver({...options,getExports:()=>guardedEx,getMemory:()=>{bufferReads++;if(boundary==='buffer')clock=8000;return buffer;}});
 g.activate('guards');g.input(0x201);g.word(0xca16a9eb);for(const v of [98306,0x201,1,0x00910198,98306,0])g.word(v);
 assert.equal(afterExpiryGetters,0);assert.equal(g.status().bytes.down,0);assert.equal(g.status().reason,'deadline');
 if(boundary==='getter'){assert.equal(bufferReads,0);assert.equal(translations,0);}
 if(boundary==='buffer')assert.equal(translations,0);
 if(boundary==='translator')assert.equal(translations,1);
 g.stop('explicit stop');assert.equal(g.status().reason,'deadline');
}
const worker = fs.readFileSync(require.resolve('../lib/guest-worker.js'), 'utf8');
const generated = overlay(worker, fs.readFileSync(require.resolve('../tools/antara-win16-callback'), 'utf8'));
new vm.Script(generated); assert(generated.endsWith(worker.slice(worker.lastIndexOf('\n'))));
assert.throws(() => overlay('', ''), /anchor/);
const linkSource = linkOverlay(fs.readFileSync(require.resolve('../lib/guest-thread-host'), 'utf8'));
const moduleObject = {exports: {}}; const messages = [];
vm.runInNewContext(linkSource, {module: moduleObject, require: p => require('../lib/' + p.replace('./', '')), console});
const link = new moduleObject.exports.WorkerLink({slot: 1, log: m => messages.push(m)});
const receipt = o.status(); link._onMessage({t: 'antaraWin16Receipt', receipt});
assert.equal(link.antaraWin16Receipt, receipt); assert.equal(messages.length,0);
assert.throws(() => linkOverlay(''), /anchor/);
// Owning child receives a queue route without ever polling host DOWN.
clock=0;const child=createObserver(options);child.activate('child');
for(const v of [0xca16a9eb,98306,0x201,1,0x00910198,98306,0])child.word(v);
assert.equal(child.status().rows[0].kind,'route');assert(child.status().rows[0].owner);assert(!child.status().rows.some(r=>r.kind==='input-poll'));child.stop('test');
clock=0;const rawCap=createObserver({...options,maxWords:32,cpuNow:()=>0});rawCap.activate('raw');for(let i=0;i<1000;i++)rawCap.word(123);
assert.equal(rawCap.status().traceWords,32);assert.equal(rawCap.status().active,false);rawCap.activate('raw','up');for(let i=0;i<1000;i++)rawCap.word(123);assert.deepEqual(rawCap.status().raw,{down:32,up:32});assert.throws(()=>rawCap.activate('raw','up'),/rejected/);
let cpuClock=0;const cpuCap=createObserver({...options,cpuNow:()=>cpuClock++,maxCpuMs:2});cpuCap.activate('cpu');for(let i=0;i<100;i++)cpuCap.word(123);assert.equal(cpuCap.status().traceWords,2);assert.equal(cpuCap.status().active,false);
const throwHost={...originals,log_i32(){throw failure;}},throwProbe=install(throwHost,options);throwProbe.activate('throws');assert.throws(()=>throwHost.log_i32(1),e=>e===failure);assert.equal(throwProbe.status().active,false);throwProbe.stop();
async function coordination(){
 const acks=[];function fake(slot){const l={slot,antaraWin16Ready:true,_seq:0,_pending:new Map()};l.worker={postMessage(m){acks.push(m);const p=l._pending.get(m.seq);l._pending.delete(m.seq);p.resolve({ack:{slot,active:m.t==='antaraActivate',token:m.token,phase:m.phase,deadline:Date.now()+8000}});}};return l;}
 const main=fake(0),owner=fake(1),wine={guestWorker:{link:main},threadManager:{threads:new Map([[1,{link:owner}]])}};
 assert.equal((await activateExisting(wine,'ready','down')).length,2);assert.equal((await activateExisting(wine,'ready','up')).length,2);assert.equal(acks.length,4);
 wine.threadManager.threads.set(2,{link:fake(2)});await assert.rejects(()=>activateExisting(wine,'ready','up'),/existing Workers/);
 const failed=fake(1);failed.worker.postMessage=m=>{const p=failed._pending.get(m.seq);failed._pending.delete(m.seq);p.resolve({ack:{active:false}});};const bad={guestWorker:{link:fake(0)},threadManager:{threads:new Map([[1,{link:failed}]])}};await assert.rejects(()=>activateExisting(bad,'reject','down'),/click refused/);assert(acks.some(m=>m.t==='antaraStop'));
 console.log('Antara explicit forwarded-owner route, DOWN/UP acknowledgment, late-worker refusal, raw CPU/word caps, original-forward-once, error cleanup, deadline/getter/translator and generated overlay PASS');
}
coordination().catch(e=>{console.error(e);process.exitCode=1;});
