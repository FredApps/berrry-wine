'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WAT_FILES } = require('../lib/compile-wat');

// These synthetic entry points share WIN16_THUNK_SEL. A collision compiles
// cleanly but takes whichever branch occurs first in win16_dispatch.
const slots = new Map();
for (const file of WAT_FILES) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const code = source.replace(/;;[^\n]*/g, '');
  const declarations = code.matchAll(/\(global\s+(\$WIN16_\w+)\s+i32\s+\(i32\.const\s+(0x[\da-f]+|\d+)\)\)/gi);
  for (const [,name,literal] of declarations) {
    const offset = Number(literal);
    if (offset < 0xff00 || offset > 0xffff) continue;
    assert(!slots.has(offset), `${name} collides with ${slots.get(offset)} at 0x${offset.toString(16)}`);
    slots.set(offset, name);
  }
}
assert([...slots.values()].includes('$WIN16_DDE_CB'), 'DDE callback slot was inspected');
assert([...slots.values()].includes('$WIN16_CONT_CREATE_SIZE'), 'CreateWindow continuation was inspected');
console.log(`PASS ${slots.size} unique Win16 synthetic thunk offsets`);
