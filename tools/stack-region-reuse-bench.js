#!/usr/bin/env node
'use strict';
// Synthetic upper bound for region-level stack/address reuse. This is not the
// production decoder/JIT: it deliberately admits only one direct, non-aliasing
// guest-memory domain, then compares six lowerings of identical work.
const assert = require('assert');
const { performance } = require('perf_hooks');
const { compileWatx } = require('./watx-differential');

const ARMS = ['split', 'span', 'stack', 'addr', 'region_iter', 'region_hoist'];
const BODIES = [1, 16];
const BODY_GA = 0x500000, STACK_GA = 0x580000;
const wa = ga => ga - 0x400000 + 0x10000;

function loads(n, baseExpr) {
  return Array.from({length:n}, (_,i) =>
    `(local.set $acc (i32.add (local.get $acc) (i32.load offset=${i*4} ${baseExpr})))`).join('\n');
}
function splitBody(n, name='$split') {
  const body = Array.from({length:n}, (_,i) =>
    `(local.set $acc (i32.add (local.get $acc) (i32.load (call $tr (i32.const ${BODY_GA+i*4})))))`).join('\n');
  return `(func ${name}${n} (param $reps i32) (param $seed i32) (result i32)
    (local $i i32) (local $esp i32) (local $acc i32)
    (local $a i32) (local $b i32) (local $c i32)
    (local.set $esp (i32.const ${STACK_GA}))
    (local.set $a (i32.xor (local.get $seed) (i32.const 0x11111111)))
    (local.set $b (i32.xor (local.get $seed) (i32.const 0x22222222)))
    (local.set $c (i32.xor (local.get $seed) (i32.const 0x33333333)))
    (block $done (loop $loop (br_if $done (i32.ge_u (local.get $i) (local.get $reps)))
      (local.set $esp (i32.sub (local.get $esp) (i32.const 4))) (i32.store (call $tr (local.get $esp)) (local.get $a))
      (local.set $esp (i32.sub (local.get $esp) (i32.const 4))) (i32.store (call $tr (local.get $esp)) (local.get $b))
      (local.set $esp (i32.sub (local.get $esp) (i32.const 4))) (i32.store (call $tr (local.get $esp)) (local.get $c))
      (local.set $esp (i32.sub (local.get $esp) (i32.const 16)))
      ${body}
      (i32.store (call $tr (local.get $esp)) (local.get $acc))
      (local.set $esp (i32.add (local.get $esp) (i32.const 16)))
      (local.set $c (i32.load (call $tr (local.get $esp)))) (local.set $esp (i32.add (local.get $esp) (i32.const 4)))
      (local.set $b (i32.load (call $tr (local.get $esp)))) (local.set $esp (i32.add (local.get $esp) (i32.const 4)))
      (local.set $a (i32.load (call $tr (local.get $esp)))) (local.set $esp (i32.add (local.get $esp) (i32.const 4)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop)))
    (global.set $last_esp (local.get $esp))
    (i32.xor (local.get $acc) (i32.xor (local.get $esp) (i32.xor (local.get $a) (i32.xor (local.get $b) (local.get $c))))))`;
}
function spanBody(n) {
  const body = Array.from({length:n}, (_,i) =>
    `(local.set $acc (i32.add (local.get $acc) (i32.load (call $tr (i32.const ${BODY_GA+i*4})))))`).join('\n');
  return `(func $span${n} (param $reps i32) (param $seed i32) (result i32)
    (local $i i32)(local $esp i32)(local $p i32)(local $acc i32)(local $a i32)(local $b i32)(local $c i32)
    (local.set $esp (i32.const ${STACK_GA}))(local.set $a (i32.xor (local.get $seed)(i32.const 0x11111111)))(local.set $b (i32.xor (local.get $seed)(i32.const 0x22222222)))(local.set $c (i32.xor (local.get $seed)(i32.const 0x33333333)))
    (block $d(loop $l(br_if $d(i32.ge_u(local.get $i)(local.get $reps)))
      (local.set $esp(i32.sub(local.get $esp)(i32.const 12)))(local.set $p(call $span(local.get $esp)(i32.const 12)))
      (i32.store offset=8(local.get $p)(local.get $a))(i32.store offset=4(local.get $p)(local.get $b))(i32.store(local.get $p)(local.get $c))
      (local.set $esp(i32.sub(local.get $esp)(i32.const 16))) ${body}
      (i32.store(call $tr(local.get $esp))(local.get $acc))(local.set $esp(i32.add(local.get $esp)(i32.const 16)))
      (local.set $p(call $span(local.get $esp)(i32.const 12)))(local.set $c(i32.load(local.get $p)))(local.set $b(i32.load offset=4(local.get $p)))(local.set $a(i32.load offset=8(local.get $p)))(local.set $esp(i32.add(local.get $esp)(i32.const 12)))
      (local.set $i(i32.add(local.get $i)(i32.const 1)))(br $l)))
    (global.set $last_esp(local.get $esp))(i32.xor(local.get $acc)(i32.xor(local.get $esp)(i32.xor(local.get $a)(i32.xor(local.get $b)(local.get $c))))))`;
}
function regionBody(n, hoist) {
  const name = hoist ? 'region_hoist' : 'region_iter';
  return `(func $${name}${n} (param $reps i32)(param $seed i32)(param $mode i32)(result i32)
    (local $i i32)(local $esp i32)(local $sp i32)(local $bp i32)(local $acc i32)(local $a i32)(local $b i32)(local $c i32)
    ;; mode: 1 alias, 2 stack-boundary, 3 control exit. All must fall back.
    (if(local.get $mode)(then(global.set $fallbacks(i32.add(global.get $fallbacks)(i32.const 1)))(return(call $split${n}(local.get $reps)(local.get $seed)))))
    (local.set $esp(i32.const ${STACK_GA}))${hoist ? `(local.set $sp(call $span(i32.sub(local.get $esp)(i32.const 28))(i32.const 28)))(local.set $bp(call $span(i32.const ${BODY_GA})(i32.const ${n*4})))` : ''}
    ${hoist ? `(if(i32.or(i32.eqz(local.get $sp))(i32.or(i32.eqz(local.get $bp))(i32.and(i32.lt_u(local.get $sp)(i32.add(local.get $bp)(i32.const ${n*4})))(i32.lt_u(local.get $bp)(i32.add(local.get $sp)(i32.const 28))))))(then(global.set $fallbacks(i32.add(global.get $fallbacks)(i32.const 1)))(return(call $split${n}(local.get $reps)(local.get $seed)))))` : ''}
    (local.set $a(i32.xor(local.get $seed)(i32.const 0x11111111)))(local.set $b(i32.xor(local.get $seed)(i32.const 0x22222222)))(local.set $c(i32.xor(local.get $seed)(i32.const 0x33333333)))
    (block $d(loop $l(br_if $d(i32.ge_u(local.get $i)(local.get $reps)))
      ${hoist ? '' : `(local.set $sp(call $span(i32.sub(local.get $esp)(i32.const 28))(i32.const 28)))(local.set $bp(call $span(i32.const ${BODY_GA})(i32.const ${n*4})))`}
      ${hoist ? '' : `(if(i32.or(i32.eqz(local.get $sp))(i32.or(i32.eqz(local.get $bp))(i32.and(i32.lt_u(local.get $sp)(i32.add(local.get $bp)(i32.const ${n*4})))(i32.lt_u(local.get $bp)(i32.add(local.get $sp)(i32.const 28))))))(then(global.set $fallbacks(i32.add(global.get $fallbacks)(i32.const 1)))(return(call $split${n}(i32.sub(local.get $reps)(local.get $i))(local.get $seed)))))`}
      (i32.store offset=24(local.get $sp)(local.get $a))(i32.store offset=20(local.get $sp)(local.get $b))(i32.store offset=16(local.get $sp)(local.get $c))
      ${loads(n, '(local.get $bp)')}(i32.store(local.get $sp)(local.get $acc))
      (local.set $c(i32.load offset=16(local.get $sp)))(local.set $b(i32.load offset=20(local.get $sp)))(local.set $a(i32.load offset=24(local.get $sp)))
      (local.set $i(i32.add(local.get $i)(i32.const 1)))(br $l)))
    (global.set $last_esp(local.get $esp))(i32.xor(local.get $acc)(i32.xor(local.get $esp)(i32.xor(local.get $a)(i32.xor(local.get $b)(local.get $c))))))`;
}
function partialBody(n, kind) {
  const stackReuse = kind === 'stack';
  const body = Array.from({length:n}, (_,i) => stackReuse
    ? `(local.set $acc(i32.add(local.get $acc)(i32.load(call $tr(i32.const ${BODY_GA+i*4})))))`
    : `(local.set $acc(i32.add(local.get $acc)(i32.load offset=${i*4}(local.get $bp))))`).join('\n');
  const push = stackReuse
    ? `(i32.store offset=24(local.get $sp)(local.get $a))(i32.store offset=20(local.get $sp)(local.get $b))(i32.store offset=16(local.get $sp)(local.get $c))`
    : `(local.set $esp(i32.sub(local.get $esp)(i32.const 4)))(i32.store(call $tr(local.get $esp))(local.get $a))(local.set $esp(i32.sub(local.get $esp)(i32.const 4)))(i32.store(call $tr(local.get $esp))(local.get $b))(local.set $esp(i32.sub(local.get $esp)(i32.const 4)))(i32.store(call $tr(local.get $esp))(local.get $c))(local.set $esp(i32.sub(local.get $esp)(i32.const 16)))`;
  const pop = stackReuse
    ? `(local.set $c(i32.load offset=16(local.get $sp)))(local.set $b(i32.load offset=20(local.get $sp)))(local.set $a(i32.load offset=24(local.get $sp)))`
    : `(local.set $esp(i32.add(local.get $esp)(i32.const 16)))(local.set $c(i32.load(call $tr(local.get $esp))))(local.set $esp(i32.add(local.get $esp)(i32.const 4)))(local.set $b(i32.load(call $tr(local.get $esp))))(local.set $esp(i32.add(local.get $esp)(i32.const 4)))(local.set $a(i32.load(call $tr(local.get $esp))))(local.set $esp(i32.add(local.get $esp)(i32.const 4)))`;
  const spill = stackReuse ? `(i32.store(local.get $sp)(local.get $acc))` : `(i32.store(call $tr(local.get $esp))(local.get $acc))`;
  return `(func $${kind}${n}(param $reps i32)(param $seed i32)(result i32)
    (local $i i32)(local $esp i32)(local $sp i32)(local $bp i32)(local $acc i32)(local $a i32)(local $b i32)(local $c i32)
    (local.set $esp(i32.const ${STACK_GA}))
    (local.set $a(i32.xor(local.get $seed)(i32.const 0x11111111)))(local.set $b(i32.xor(local.get $seed)(i32.const 0x22222222)))(local.set $c(i32.xor(local.get $seed)(i32.const 0x33333333)))
    (block $d(loop $l(br_if $d(i32.ge_u(local.get $i)(local.get $reps))) ${stackReuse ? `(local.set $sp(call $span(i32.sub(local.get $esp)(i32.const 28))(i32.const 28)))` : `(local.set $bp(call $span(i32.const ${BODY_GA})(i32.const ${n*4})))`} ${push} ${body} ${spill} ${pop}(local.set $i(i32.add(local.get $i)(i32.const 1)))(br $l)))
    (global.set $last_esp(local.get $esp))(i32.xor(local.get $acc)(i32.xor(local.get $esp)(i32.xor(local.get $a)(i32.xor(local.get $b)(local.get $c))))))`;
}

function makeSource(instrument) { return `(memory 64)(export "memory" (memory 0))
(global $translations (mut i32)(i32.const 0))(global $fallbacks (mut i32)(i32.const 0))(global $last_esp (mut i32)(i32.const 0))
(func $tr(param $ga i32)(result i32)${instrument ? `(global.set $translations(i32.add(global.get $translations)(i32.const 1)))` : ''}(if(i32.or(i32.lt_u(local.get $ga)(i32.const 0x400000))(i32.ge_u(local.get $ga)(i32.const 0x600000)))(then(return(i32.const 0))))(i32.add(i32.sub(local.get $ga)(i32.const 0x400000))(i32.const 0x10000)))
(func $span(param $ga i32)(param $len i32)(result i32)(if(i32.or(i32.eqz(local.get $len))(i32.gt_u(i32.add(i32.and(local.get $ga)(i32.const 0xfff))(local.get $len))(i32.const 4096)))(then(return(i32.const 0))))(call $tr(local.get $ga)))
(func(export "reset_counts")(global.set $translations(i32.const 0))(global.set $fallbacks(i32.const 0)))(func(export "translations")(result i32)(global.get $translations))(func(export "fallbacks")(result i32)(global.get $fallbacks))(func(export "last_esp")(result i32)(global.get $last_esp))
${BODIES.map(n=>splitBody(n)).join('\n')}${BODIES.map(spanBody).join('\n')}${BODIES.flatMap(n=>[partialBody(n,'stack'),partialBody(n,'addr')]).join('\n')}${BODIES.flatMap(n=>[regionBody(n,false),regionBody(n,true)]).join('\n')}
${ARMS.flatMap(a=>BODIES.map(n=>`(export "${a}${n}" (func $${a}${n}))`)).join('\n')}`; }

function median(a) { const b=[...a].sort((x,y)=>x-y); return b[b.length>>1]; }
(async () => {
  const timedBytes=compileWatx(makeSource(false),{tailCalls:true}), countBytes=compileWatx(makeSource(true),{tailCalls:true});
  const [{instance},{instance:ci}]=await Promise.all([WebAssembly.instantiate(timedBytes),WebAssembly.instantiate(countBytes)]);
  const e=instance.exports, ce=ci.exports, dv=new DataView(e.memory.buffer), cdv=new DataView(ce.memory.buffer);
  const seed=0x24681357, rounds=+(process.env.STACK_REGION_ROUNDS||9), targetMs=+(process.env.STACK_REGION_TARGET_MS||100);
  function reset(d){new Uint8Array(d.buffer).fill(0xa5,wa(STACK_GA)-64,wa(STACK_GA)+64);for(let i=0;i<16;i++)d.setUint32(wa(BODY_GA)+i*4,(0x10001+i*0x101)>>>0,true);}
  function expected(n,reps,s){let one=0;for(let i=0;i<n;i++)one=(one+0x10001+i*0x101)>>>0;const acc=Math.imul(one,reps)>>>0,a=(s^0x11111111)>>>0,b=(s^0x22222222)>>>0,c=(s^0x33333333)>>>0;return{acc,a,b,c,sum:(acc^STACK_GA^a^b^c)>>>0};}
  function verify(ex,d,n,reps,s,got,label){const x=expected(n,reps,s);assert.strictEqual(got>>>0,x.sum,label+' checksum');assert.strictEqual(ex.last_esp()>>>0,STACK_GA,label+' ESP');assert.strictEqual(d.getUint32(wa(STACK_GA)-28,true),x.acc,label+' spill');assert.strictEqual(d.getUint32(wa(STACK_GA)-12,true),x.c,label+' saved C');assert.strictEqual(d.getUint32(wa(STACK_GA)-8,true),x.b,label+' saved B');assert.strictEqual(d.getUint32(wa(STACK_GA)-4,true),x.a,label+' saved A');}
  const counts={};for(const n of BODIES)for(const a of ARMS){reset(cdv);ce.reset_counts();const got=ce[`${a}${n}`](37,seed,0);verify(ce,cdv,n,37,seed,got,`count ${a}${n}`);counts[`${a}${n}`]=ce.translations();}
  // These are explicitly forced-fallback plumbing tests, not claims that the
  // synthetic module reproduced a real alias/page/control event.
  for(const n of BODIES)for(const mode of [1,2,3]){reset(cdv);ce.reset_counts();const got=ce[`region_iter${n}`](31,seed,mode);verify(ce,cdv,n,31,seed,got,`forced fallback ${n}/${mode}`);assert.strictEqual(ce.fallbacks(),1);}
  const calibrated={};for(const n of BODIES)for(const a of ARMS){let reps=100000,ms=0;reset(dv);e[`${a}${n}`](100000,seed,0);reset(dv);e[`${a}${n}`](100000,seed,0);do{reset(dv);e[`${a}${n}`](reps,seed,0);reset(dv);const t=performance.now(),got=e[`${a}${n}`](reps,seed,0);ms=performance.now()-t;verify(e,dv,n,reps,seed,got,`calibrate ${a}${n}`);if(ms<targetMs)reps*=2;}while(ms<targetMs);calibrated[`${a}${n}`]=reps;}
  const out={scope:'restricted direct non-alias synthetic domain; forced fallback plumbing only; no value caching',timedWasmBytes:timedBytes.length,instrumentedWasmBytes:countBytes.length,targetMs,rounds,results:{}};
  for(const n of BODIES){const samples=Object.fromEntries(ARMS.map(a=>[a,[]]));for(let r=0;r<rounds;r++)for(let j=0;j<ARMS.length;j++){const a=ARMS[(j+r)%ARMS.length],reps=calibrated[`${a}${n}`],s=(seed+r)>>>0;reset(dv);e.reset_counts();e[`${a}${n}`](1000,s,0);reset(dv);const t=performance.now(),sum=e[`${a}${n}`](reps,s,0)>>>0,ms=performance.now()-t;verify(e,dv,n,reps,s,sum,`sample ${a}${n}/${r}`);assert(ms>=30,`sample ${a}${n}/${r} too short: ${ms.toFixed(2)}ms`);samples[a].push(ms/reps);out.results[`${a}${n}`]={reps,instrumentedTranslationsPer37:counts[`${a}${n}`]};}for(const a of ARMS)out.results[`${a}${n}`].medianNsPerRegion=median(samples[a])*1e6;}
  console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
