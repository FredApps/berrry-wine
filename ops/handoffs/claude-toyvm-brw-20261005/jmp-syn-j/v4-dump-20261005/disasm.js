// Offline disassembly of the dumped BRW code (8:be00 + n), 32-bit, from a
// few block heads seen in the state windows. Pure JS; no emulator.
const fs = require('fs'); const path = require('path');
const { disasmAt } = require('/home/user/wine-assembly/tools/disasm.js');
const buf = fs.readFileSync(path.join(__dirname, 'l1-code.bin'));
const BASE = 0xbe00;
for (const [ip, n] of [[0xbec5, 24], [0xc179, 40], [0xc290, 30], [0xc34b, 12]]) {
  console.log(`--- 8:${ip.toString(16)}`);
  const lines = disasmAt(buf, ip - BASE, ip, n, null, { bits: 32 });
  console.log(Array.isArray(lines) ? lines.join('\n') : String(lines));
}
