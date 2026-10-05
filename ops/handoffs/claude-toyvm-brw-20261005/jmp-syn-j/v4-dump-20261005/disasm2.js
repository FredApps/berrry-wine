// Disassemble 8:c30f..c34b of the dumped BRW code (32-bit), offline.
const fs = require('fs'); const path = require('path');
const { disasmAt } = require('/home/user/wine-assembly/tools/disasm.js');
const buf = fs.readFileSync(path.join(__dirname, 'l1-code.bin'));
const lines = disasmAt(buf, 0xc30f - 0xbe00, 0xc30f, 24, null, { bits: 32 });
console.log(Array.isArray(lines) ? lines.join('\n') : String(lines));
