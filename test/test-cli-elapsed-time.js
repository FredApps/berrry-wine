#!/usr/bin/env node
'use strict';
const assert=require('assert');
const path=require('path');
const {spawnSync}=require('child_process');
const started=performance.now();
const run=spawnSync(process.execPath,['test/run.js','--exe=test/binaries/calc.exe',
  '--max-batches=0','--max-seconds=120','--quiet-api','--quiet-blocks'],
  {cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
assert.ifError(run.error);
assert.strictEqual(run.status,0,run.stdout+run.stderr);
const observed=(performance.now()-started)/1000;
const match=run.stdout.match(/Stats: \d+ API calls, 0 batches in ([\d.]+)s \(0 batches\/s\)/);
assert(match,run.stdout);
const elapsed=Number(match[1]);
assert(elapsed>=0&&elapsed<=observed+.01,'measured execution cannot exceed whole child lifetime');
assert(!run.stdout.includes('[max-seconds]'),'zero-batch stop did not expire its wall guard');
console.log('PASS CLI elapsed time measures execution instead of reporting the configured deadline');
