'use strict';
// Can a child writeFileSync('/dev/fd/3') when the parent spawned fd 3 as 'pipe'?
// And through a real pipe(2) handed in as fd 3 instead? No emulator.
const { spawn } = require('child_process');
const fs = require('fs');
if (process.argv[2] === 'child') {
  try { fs.writeFileSync('/dev/fd/3', 'x'.repeat(Number(process.argv[3])) + '\n'); process.exit(0); }
  catch (e) { console.error(`child: ${e.code} ${e.message}`); process.exit(3); }
}
function trial(label, stdio3) {
  return new Promise((res) => {
    const ch = spawn(process.execPath, [__filename, 'child', String(20 * 1048576)], { stdio: ['ignore', 'inherit', 'inherit', stdio3] });
    let n = 0;
    if (ch.stdio[3]) ch.stdio[3].on('data', (b) => { n += b.length; });
    ch.on('close', (code) => { console.log(`${label}: exit ${code}, parent received ${n} bytes`); res(); });
  });
}
(async () => {
  await trial("stdio 'pipe'", 'pipe');
})();
