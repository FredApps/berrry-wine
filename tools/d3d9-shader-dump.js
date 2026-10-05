#!/usr/bin/env node
// Disassemble a raw D3D shader blob -- the sibling of tools/d3d9-decl-decode.js.
//
//   node tools/d3d9-shader-dump.js <file.bin> [--raw] [--from=N] [--count=N]
//
// A refused shader is the one thing every "why does this game fall back to
// fixed-function" investigation ends up needing, and until now reading one
// meant hand-decoding dwords in an eval. lib/d3d9-shader.js already knows the
// token format; this just points it at a file and prints what it finds.
//
// Two listings, because they answer different questions. The disassembly says
// what the shader DOES and stops at the first token the parser cannot read --
// which is the interesting line, so the error is printed as a line rather than
// thrown away. The `--raw` dword listing says what the bytes ARE, which is the
// only way to check a reported error offset that the disassembly never reaches
// (the parser walks by arity, so its instruction boundaries and a raw offset
// are different coordinate systems and disagreeing is the finding, not a bug).
'use strict';
const fs = require('fs');
const D3D9Shader = require('../lib/d3d9-shader');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = name => args.find(a => a.startsWith(`--${name}=`));
const num = (name, fallback) => { const f = flag(name); return f ? Number(f.split('=')[1]) : fallback; };
if (!file) {
  console.error('usage: node tools/d3d9-shader-dump.js <file.bin> [--raw] [--from=N] [--count=N]');
  process.exit(2);
}

const bytes = fs.readFileSync(file);
if (bytes.length % 4) console.log(`note: ${bytes.length} bytes is not a whole number of dwords`);
const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
const hex = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');

const version = words[0] >>> 0;
const stage = version >>> 16 === 0xfffe ? 'vertex' : version >>> 16 === 0xffff ? 'pixel' : '???';
console.log(`${file}: ${words.length} dwords, ${stage} shader, version ${hex(version)} ` +
  `(${stage.slice(0, 2)}_${(version >> 8) & 255}_${version & 255})`);

const rawListing = () => {
  const from = num('from', 0), count = num('count', words.length - from);
  for (let i = from; i < Math.min(words.length, from + count); i++) {
    const w = words[i] >>> 0;
    // Annotate the three shapes a reader is usually trying to tell apart.
    const kind = w === 0x0000ffff ? 'END'
      : (w & 0xffff) === 0xfffe ? `COMMENT len=${(w >>> 16) & 0x7fff}`
      : w & 0x80000000 ? `param bank=${((w >>> 28) & 7) | ((w >>> 8) & 24)} index=${w & 2047}`
      : `instr op=${w & 0xffff} len=${(w >>> 24) & 15}`;
    console.log(`  [${String(i).padStart(4)}] ${hex(w)}  ${kind}`);
  }
};
if (args.includes('--raw')) rawListing();

try {
  const parsed = D3D9Shader.parse(words);
  parsed.instructions.forEach((ins, i) => {
    // The dword offset is printed because a reported error offset and an
    // instruction index are different coordinates, and lining them up by eye
    // is the whole point of reading a refused shader.
    const args = (ins.args || []).map(a => {
      const w = a >>> 0;
      return ins.opcode === 81 ? hex(w)
        : `b${((w >>> 28) & 7) | ((w >>> 8) & 24)}#${w & 2047}${w & 0x2000 ? '[a0]' : ''}`;
    }).join(', ');
    console.log(`  ${String(i).padStart(3)} @${String(ins.offset).padStart(4)}: ` +
      `${ins.name}${args ? ' ' + args : ''}`);
  });
  console.log(`parsed ${parsed.instructions.length} instructions`);
} catch (error) {
  // Expected on exactly the shaders this tool exists for, and a bare message
  // is not enough to act on: the raw listing beside it is what says whether
  // the stream is truncated, whether the offset is inside a comment, or
  // whether a real opcode is missing. Print it unasked on a failure.
  console.log(`parse stopped: ${error.message}`);
  if (!args.includes('--raw')) rawListing();
}
