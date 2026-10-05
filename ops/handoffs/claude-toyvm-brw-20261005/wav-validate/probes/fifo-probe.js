'use strict';
// Can a child writeFileSync(FIFO) 20 MB while the parent, holding the FIFO
// O_RDWR|O_NONBLOCK, drains it with readSync under a byte cap? No emulator.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
if (process.argv[2] === 'child') {
  fs.writeFileSync(process.argv[3], 'x'.repeat(Number(process.argv[4]) - 1) + '\n');
  process.exit(0);
}
const fifo = path.join(process.argv[2] || '/tmp', `probe-${process.pid}.fifo`);
if (spawnSync('mkfifo', [fifo]).status !== 0) throw new Error('mkfifo');
const fd = fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
const N = 20 * 1048576, buf = Buffer.alloc(1 << 20);
let got = 0;
const drain = () => { for (;;) { try { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) return; got += n; } catch (e) { if (e.code === 'EAGAIN') return; throw e; } } };
const t = setInterval(drain, 10);
const t0 = Date.now();
const ch = spawn(process.execPath, [__filename, 'child', fifo, String(N)], { stdio: 'inherit' });
ch.on('close', (code) => {
  clearInterval(t); drain(); fs.closeSync(fd); fs.unlinkSync(fifo);
  console.log(`child exit ${code}; parent read ${got} of ${N} bytes in ${Date.now() - t0} ms`);
});
