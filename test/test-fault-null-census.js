'use strict';

// --fault-null must survive a guest that faults in a loop.
//
// Black & White 2's picker walks a NULL array: one EIP produced 617,411
// unmapped accesses in one run, and a later run died outright -- the host V8
// heap hit 4GB and aborted *inside console.log*, because Node's process.stdout
// is asynchronous when it is a pipe and the guest outran the reader. The
// diagnostic killed the run before it could report the bug it was armed for.
//
// So the contract is: at most a fixed number of lines per EIP, whatever the
// guest does, and a census at the end that still names every EIP, its count and
// the address range it walked. The census registers its own exit hook on the
// first fault, so it needs nothing from the host that armed the flag -- and a
// host that never faults never installs the hook.

const assert = require('assert');
const { createHostImports, reportUnmappedFaults, unmappedFaults } =
  require('../lib/host-imports');

const lines = [];
const realLog = console.log;
console.log = (...parts) => lines.push(parts.join(' '));
let host;
try {
  host = createHostImports({ getMemory: () => new ArrayBuffer(65536) }).host;
  // One EIP scanning a NULL array, exactly the shape that killed the run.
  for (let i = 0; i < 200000; i++) host.unmapped_trace(i * 4, 0x9e5269);
  // A second EIP faulting a handful of times keeps its detail.
  for (let i = 0; i < 3; i++) host.unmapped_trace(0x40 + i, 0x9e17d0);
  reportUnmappedFaults();
} finally {
  console.log = realLog;
}

const faults = lines.filter(line => line.startsWith('[fault] unmapped'));
assert.ok(faults.length < 200, `200003 faults printed ${faults.length} lines; the cap did not hold`);
assert.ok(faults.some(line => line.includes('0x9e17d0')),
  'the rare EIP must still be printed in full -- the cap is per EIP, not global');

const census = lines.filter(line => line.startsWith('[fault] census')
  || line.startsWith('[fault]   eip='));
assert.ok(census[0].includes('200003') && census[0].includes('2 eip(s)'),
  `census must total every fault, printed or not: ${census[0]}`);
const hot = census.find(line => line.includes('0x9e5269'));
assert.ok(hot.includes('x200000'), `census must keep the real count: ${hot}`);
assert.ok(hot.includes('0x0-0xc34fc'),
  `census must name the range the scan walked: ${hot}`);


// Reporting is one-shot: the exit hook the first fault registered must not print
// the same census a second time after an explicit call already did.
const after = [];
console.log = (...parts) => after.push(parts.join(' '));
try { reportUnmappedFaults(); } finally { console.log = realLog; }
assert.strictEqual(after.length, 0,
  `a second report printed ${after.length} line(s); the exit hook would duplicate the census`);

console.log(`PASS --fault-null capped 200003 faults at ${faults.length} lines and kept the census`);
